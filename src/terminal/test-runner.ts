import fs from 'fs';
import path from 'path';
import { PTYManager } from './pty-manager.js';
import { settings } from '../config/settings.js';
import { Logger } from '../core/logger.js';
import { LogParser, BugReport } from '../watchers/log-parser.js';

export interface TestResult {
  success: boolean;
  exitCode: number;
  output: string;
  commandUsed: string;
  bugReport: BugReport | null;
}

export class TestRunner {
  private ptyManager: PTYManager;
  private sessionName: string = 'test-runner';

  constructor() {
    this.ptyManager = PTYManager.getInstance();
  }

  public detectTestCommand(cwd: string): { command: string; args: string[] } {
    const files = fs.existsSync(cwd) ? fs.readdirSync(cwd) : [];

    // 1. Python projects
    const hasPytestConfig =
      fs.existsSync(path.join(cwd, 'pytest.ini')) ||
      fs.existsSync(path.join(cwd, 'pyproject.toml'));
    const testDir = path.join(cwd, 'tests');
    const testDirAlt = path.join(cwd, 'test');
    const hasPythonTestFiles =
      files.some((f) => (f.startsWith('test_') || f.endsWith('_test.py')) && f.endsWith('.py')) ||
      (fs.existsSync(testDir) && fs.readdirSync(testDir).some((f) => f.endsWith('.py'))) ||
      (fs.existsSync(testDirAlt) && fs.readdirSync(testDirAlt).some((f) => f.endsWith('.py')));

    if (hasPytestConfig) {
      return { command: 'pytest', args: ['-q'] };
    }
    if (hasPythonTestFiles) {
      return { command: 'python3', args: ['-m', 'unittest', 'discover'] };
    }

    // 2. Node.js (package.json)
    const packageJsonPath = path.join(cwd, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (
          pkg.scripts &&
          pkg.scripts.test &&
          !pkg.scripts.test.includes('no test specified')
        ) {
          return { command: 'npm', args: ['test'] };
        }
      } catch {
        // ignore
      }
    }

    // Check for JS/TS test files in project (Node built-in test runner)
    const hasJsTsTestFiles =
      files.some((f) => (f.includes('test') || f.includes('spec')) && (f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.mjs'))) ||
      (fs.existsSync(testDir) && fs.readdirSync(testDir).some((f) => f.endsWith('.js') || f.endsWith('.ts'))) ||
      (fs.existsSync(testDirAlt) && fs.readdirSync(testDirAlt).some((f) => f.endsWith('.js') || f.endsWith('.ts')));

    if (hasJsTsTestFiles) {
      if (files.some((f) => f.endsWith('.ts')) || (fs.existsSync(testDir) && fs.readdirSync(testDir).some((f) => f.endsWith('.ts')))) {
        return { command: 'npx', args: ['tsx', '--test'] };
      }
      return { command: 'node', args: ['--test'] };
    }

    // 3. Maven
    if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
      return { command: 'mvn', args: ['test', '-B'] };
    }

    // 4. Gradle
    if (fs.existsSync(path.join(cwd, 'gradlew'))) {
      return { command: './gradlew', args: ['test'] };
    }
    if (
      fs.existsSync(path.join(cwd, 'build.gradle')) ||
      fs.existsSync(path.join(cwd, 'build.gradle.kts'))
    ) {
      return { command: 'gradle', args: ['test'] };
    }

    // 5. Rust
    if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
      return { command: 'cargo', args: ['test'] };
    }

    // 6. Go
    if (fs.existsSync(path.join(cwd, 'go.mod'))) {
      return { command: 'go', args: ['test', './...'] };
    }

    // 7. General fallback based on existing source files
    if (fs.existsSync(packageJsonPath)) {
      return { command: 'npm', args: ['test'] };
    }
    if (files.some((f) => f.endsWith('.py'))) {
      return { command: 'python3', args: ['-m', 'unittest', 'discover'] };
    }
    if (files.some((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
      return { command: 'node', args: ['--test'] };
    }

    // No test suite detected
    return { command: '', args: [] };
  }

  public async runTests(
    cwd?: string,
    customCommand?: string,
    customArgs?: string[]
  ): Promise<TestResult> {
    const config = settings.get();
    const targetCwd = cwd || config.projectPath;

    let { command, args } = this.detectTestCommand(targetCwd);
    if (customCommand) {
      command = customCommand;
      args = customArgs || [];
    }

    if (!command) {
      Logger.info(`ℹ Không tìm thấy bài kiểm thử tự động nào được thiết lập tại ${targetCwd}. Đánh dấu task thành công.`);
      return {
        success: true,
        exitCode: 0,
        output: 'Chưa có cấu hình bài kiểm thử (Không có test files hay test runner phù hợp).',
        commandUsed: 'none',
        bugReport: null,
      };
    }

    const commandStr = `${command} ${args.join(' ')}`;
    Logger.agentMessage('Tester', `Chạy kiểm thử: \`${commandStr}\` trên ${targetCwd}`);

    this.ptyManager.spawnSession({
      name: this.sessionName,
      command,
      args,
      cwd: targetCwd,
      onData: (chunk) => {
        Logger.ptyOutput('Test-Runner', chunk);
      },
    });

    try {
      const exitCode = await this.ptyManager.waitForExit(this.sessionName, 120000);
      const output = this.ptyManager.getSessionLogs(this.sessionName);
      const bugReport = LogParser.parse(output, exitCode);

      const success = exitCode === 0 && !bugReport;

      if (success) {
        Logger.success('Tất cả kiểm thử đã chạy thành công! (Exit code: 0)');
      } else {
        Logger.warn(`Kiểm thử thất bại! Exit code: ${exitCode}`);
        if (bugReport) {
          Logger.error(`Tóm tắt lỗi: ${bugReport.summary}`);
          if (bugReport.failedFile) {
            Logger.info(`Tệp tin lỗi: ${bugReport.failedFile}:${bugReport.lineNumber || '1'}`);
          }
        }
      }

      return {
        success,
        exitCode,
        output,
        commandUsed: commandStr,
        bugReport,
      };
    } catch (err: any) {
      Logger.error(`Lỗi thực thi TestRunner: ${err.message}`);
      const output = this.ptyManager.getSessionLogs(this.sessionName);
      const bugReport = LogParser.parse(output, -1);
      return {
        success: false,
        exitCode: -1,
        output,
        commandUsed: commandStr,
        bugReport,
      };
    }
  }

  public kill(): void {
    this.ptyManager.killSession(this.sessionName);
  }
}
