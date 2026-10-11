import { PTYManager } from './pty-manager.js';
import { settings } from '../config/settings.js';
import { Logger } from '../core/logger.js';
import path from 'path';

export interface DevWorkerResult {
  success: boolean;
  output: string;
  exitCode: number;
}

export class DevWorker {
  private ptyManager: PTYManager;
  private sessionName: string = 'dev-worker';

  constructor() {
    this.ptyManager = PTYManager.getInstance();
  }

  public async runPrompt(
    prompt: string,
    cwd?: string,
    onProgress?: (chunk: string) => void
  ): Promise<DevWorkerResult> {
    const config = settings.get();
    const targetCwd = cwd || config.projectPath;

    Logger.agentMessage('Dev', `Khởi chạy Claude CLI trên thư mục: ${targetCwd}`);

    // Prepare Claude CLI env
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: config.providerUrl,
      ANTHROPIC_API_KEY: config.apiKey,
      OPENAI_API_BASE: config.providerUrl,
      OPENAI_API_KEY: config.apiKey,
      CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
    };

    // Use claude command
    const command = 'claude';
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
          Logger.ptyOutput('Dev-Worker', chunk);
        }
      },
    });

    try {
      const exitCode = await this.ptyManager.waitForExit(this.sessionName, 180000); // 3 min timeout
      const output = this.ptyManager.getSessionLogs(this.sessionName);
      return {
        success: exitCode === 0,
        output,
        exitCode,
      };
    } catch (err: any) {
      Logger.error(`Lỗi thực thi DevWorker: ${err.message}`);
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
