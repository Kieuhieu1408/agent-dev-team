import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { Logger } from '../core/logger.js';

export interface SpawnSessionOptions {
  name: string;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
  onData?: (data: string) => void;
}

export interface TerminalSession {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  ptyProcess: pty.IPty;
  logs: string[];
  isAlive: boolean;
  exitCode?: number;
}

export class PTYManager extends EventEmitter {
  private sessions: Map<string, TerminalSession> = new Map();
  private static instance: PTYManager;

  private constructor() {
    super();
  }

  public static getInstance(): PTYManager {
    if (!PTYManager.instance) {
      PTYManager.instance = new PTYManager();
    }
    return PTYManager.instance;
  }

  public spawnSession(options: SpawnSessionOptions): TerminalSession {
    const { name, command, args = [], cwd, env = {}, onData } = options;

    // Terminate existing session with the same name if exists
    if (this.sessions.has(name)) {
      this.killSession(name);
    }

    const mergedEnv = {
      ...process.env,
      ...env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>;

    const ptyProcess = pty.spawn(command, args, {
      name: 'xterm-color',
      cols: 120,
      rows: 40,
      cwd,
      env: mergedEnv,
    });

    const session: TerminalSession = {
      id: name,
      name,
      command,
      args,
      cwd,
      ptyProcess,
      logs: [],
      isAlive: true,
    };

    ptyProcess.onData((data: string) => {
      session.logs.push(data);
      if (onData) {
        onData(data);
      }
      this.emit('data', { name, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      session.isAlive = false;
      session.exitCode = exitCode;
      this.emit('exit', { name, exitCode });
    });

    this.sessions.set(name, session);
    return session;
  }

  public writeToSession(name: string, data: string): void {
    const session = this.sessions.get(name);
    if (!session || !session.isAlive) {
      throw new Error(`Terminal session "${name}" không tồn tại hoặc đã dừng.`);
    }
    session.ptyProcess.write(data);
  }

  public killSession(name: string): void {
    const session = this.sessions.get(name);
    if (session && session.isAlive) {
      try {
        session.ptyProcess.kill();
      } catch {
        // ignore
      }
      session.isAlive = false;
    }
    this.sessions.delete(name);
  }

  public killAll(): void {
    for (const name of this.sessions.keys()) {
      this.killSession(name);
    }
  }

  public getSession(name: string): TerminalSession | undefined {
    return this.sessions.get(name);
  }

  public getSessionLogs(name: string): string {
    const session = this.sessions.get(name);
    if (!session) return '';
    return session.logs.join('');
  }

  public getAllLogs(): Record<string, string> {
    const res: Record<string, string> = {};
    for (const [name, session] of this.sessions.entries()) {
      res[name] = session.logs.join('');
    }
    return res;
  }

  public async waitForExit(name: string, timeoutMs: number = 120000): Promise<number> {
    const session = this.sessions.get(name);
    if (!session) {
      throw new Error(`Session "${name}" không tìm thấy.`);
    }
    if (!session.isAlive && session.exitCode !== undefined) {
      return session.exitCode;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.killSession(name);
        reject(new Error(`Timeout: Session "${name}" không thoát sau ${timeoutMs / 1000}s.`));
      }, timeoutMs);

      const exitListener = ({ name: exitedName, exitCode }: { name: string; exitCode: number }) => {
        if (exitedName === name) {
          clearTimeout(timer);
          this.removeListener('exit', exitListener);
          resolve(exitCode);
        }
      };

      this.on('exit', exitListener);
    });
  }
}
