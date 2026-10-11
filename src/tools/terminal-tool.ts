import { PTYManager } from '../terminal/pty-manager.js';
import { Guardrails } from '../core/guardrails.js';
import { Logger } from '../core/logger.js';

export class TerminalTool {
  public static async execute(command: string, cwd: string): Promise<{ success: boolean; output: string }> {
    const check = Guardrails.check(command);
    if (!check.allowed) {
      Logger.error(`Từ chối chạy lệnh: ${check.reason}`);
      return { success: false, output: `Bị chặn bởi Guardrail: ${check.reason}` };
    }

    if (check.requiresConfirmation) {
      Logger.warn(`Lệnh yêu cầu lưu ý an toàn: ${check.reason}`);
    }

    const pty = PTYManager.getInstance();
    const sessionName = `term-tool-${Date.now()}`;
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    pty.spawnSession({
      name: sessionName,
      command: cmd,
      args,
      cwd,
    });

    try {
      const exitCode = await pty.waitForExit(sessionName, 60000);
      const output = pty.getSessionLogs(sessionName);
      return { success: exitCode === 0, output };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  }
}
