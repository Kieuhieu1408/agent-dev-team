import { PTYManager } from './pty-manager.js';
import { settings } from '../config/settings.js';
import { Logger } from '../core/logger.js';
import { TokenTracker } from '../core/token-tracker.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';

export type ClaudeWorkerRole = 'EXPLORER' | 'DEVELOPER' | 'AUDITOR';

export interface ClaudeWorkerResult {
  success: boolean;
  output: string;
  exitCode: number;
}

export interface ClaudeWorkerOptions {
  sessionName?: string;
  role?: ClaudeWorkerRole;
  timeoutMs?: number;
}

export class ClaudeWorker {
  protected ptyManager: PTYManager;
  protected sessionName: string;
  protected role: ClaudeWorkerRole;
  protected timeoutMs: number;

  constructor(options: ClaudeWorkerOptions = {}) {
    this.ptyManager = PTYManager.getInstance();
    this.role = options.role || 'DEVELOPER';
    this.sessionName =
      options.sessionName || (this.role === 'EXPLORER' ? 'explorer-worker' : 'dev-worker');
    this.timeoutMs = options.timeoutMs || 180000;
  }

  public static isClaudeAvailable(): boolean {
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return true;
      }
    }
    try {
      const res = spawnSync('which', ['claude'], { encoding: 'utf-8' });
      return res.status === 0 && !!res.stdout.trim();
    } catch {
      return false;
    }
  }

  protected resolveClaudeExecutable(): string {
    const candidates = [
      path.join(os.homedir(), '.local', 'bin', 'claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return c;
      }
    }
    return 'claude';
  }

  public async runPrompt(
    prompt: string,
    cwd?: string,
    onProgress?: (chunk: string) => void
  ): Promise<ClaudeWorkerResult> {
    const config = settings.get();
    const targetCwd = cwd || config.projectPath;

    const roleTag =
      this.role === 'EXPLORER'
        ? 'Explorer Sub-Agent'
        : this.role === 'AUDITOR'
        ? 'Auditor Sub-Agent'
        : 'Developer Sub-Agent';

    Logger.agentMessage(
      'Master Agent',
      `🏛️ Điều phối ${roleTag} (Claude Code CLI) trên terminal [${this.sessionName}] tại: ${targetCwd}`
    );

    // Prepare Claude CLI env
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: config.providerUrl,
      ANTHROPIC_API_KEY: config.apiKey,
      OPENAI_API_BASE: config.providerUrl,
      OPENAI_API_KEY: config.apiKey,
      CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
    };

    // Resolve claude binary path
    const command = this.resolveClaudeExecutable();
    const args = ['-p', prompt, '--dangerously-skip-permissions'];
    if (config.model) {
      args.push('--model', config.model);
    }

    this.ptyManager.spawnSession({
      name: this.sessionName,
      command,
      args,
      cwd: targetCwd,
      env,
      onData: (chunk) => {
        if (onProgress) {
          onProgress(chunk);
        } else {
          if (
            chunk.includes('[claude-code:unrecognized_model]') ||
            chunk.includes("isn't described by this version's model catalog")
          ) {
            return;
          }
          Logger.ptyOutput(roleTag, chunk);
        }
      },
    });

    try {
      const exitCode = await this.ptyManager.waitForExit(this.sessionName, this.timeoutMs);
      const output = this.ptyManager.getSessionLogs(this.sessionName);

      // Record Claude CLI token usage
      const promptTokens = Math.max(1, Math.round(prompt.length / 4));
      const completionTokens = Math.max(1, Math.round(output.length / 4));
      TokenTracker.getInstance().recordUsage(
        promptTokens,
        completionTokens,
        `Claude CLI (${this.role})`
      );

      return {
        success: exitCode === 0,
        output,
        exitCode,
      };
    } catch (err: any) {
      Logger.error(`Lỗi thực thi ${roleTag}: ${err.message}`);
      return {
        success: false,
        output: this.ptyManager.getSessionLogs(this.sessionName),
        exitCode: -1,
      };
    }
  }

  public kill(): void {
    this.ptyManager.killSession(this.sessionName);
  }
}
