import readline from 'readline';
import chalk from 'chalk';
import { settings } from '../config/settings.js';
import { Logger } from './logger.js';
import { TaskItem } from './state-manager.js';

export class HITL {
  private static pendingResolver: ((answer: boolean) => void) | null = null;
  private static defaultChoice: boolean = true;
  private static isInteractiveMode: boolean = false;
  private static inputQueue: string[] = [];

  public static setInteractiveMode(interactive: boolean): void {
    this.isInteractiveMode = interactive;
  }

  public static hasPendingQuestion(): boolean {
    return this.pendingResolver !== null;
  }

  public static queueInput(line: string): void {
    if (this.pendingResolver) {
      this.handleAnswer(line);
    } else {
      this.inputQueue.push(line);
    }
  }

  public static popQueuedInput(): string | undefined {
    return this.inputQueue.shift();
  }

  public static hasQueuedInput(): boolean {
    return this.inputQueue.length > 0;
  }

  public static handleAnswer(answer: string): boolean {
    if (!this.pendingResolver) return false;
    const trimmed = answer.trim().toLowerCase();
    let result = this.defaultChoice;
    if (trimmed) {
      result = trimmed === 'y' || trimmed === 'yes';
    }
    const resolver = this.pendingResolver;
    this.pendingResolver = null;
    resolver(result);
    return true;
  }

  public static async askConfirmation(
    question: string,
    defaultYes: boolean = true
  ): Promise<boolean> {
    const config = settings.get();
    if (config.autoConfirm) {
      Logger.info(`Auto-Confirm đang BẬT -> Tự động phê duyệt: "${question}"`);
      return true;
    }

    const suffix = defaultYes
      ? chalk.green.bold(' [Y/n] ')
      : chalk.yellow.bold(' [y/N] ');
    const promptText = `\n${chalk.bold.yellow('🤝 [Human-in-the-Loop]')} ${chalk.white.bold(question)}${suffix}`;

    // If an answer was already queued in interactive mode, consume it directly
    if (this.isInteractiveMode && this.inputQueue.length > 0) {
      process.stdout.write(promptText);
      const queued = this.inputQueue.shift()!;
      console.log(chalk.bold(queued || (defaultYes ? 'y' : 'n')));
      const trimmed = queued.trim().toLowerCase();
      if (!trimmed) return defaultYes;
      return trimmed === 'y' || trimmed === 'yes';
    }

    if (this.isInteractiveMode) {
      process.stdout.write(promptText);
      return new Promise<boolean>((resolve) => {
        this.defaultChoice = defaultYes;
        this.pendingResolver = resolve;
      });
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(promptText, (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        if (!trimmed) {
          resolve(defaultYes);
        } else {
          resolve(trimmed === 'y' || trimmed === 'yes');
        }
      });
    });
  }

  public static async confirmPlanningDone(
    tasks: TaskItem[],
    architectureSummary?: string
  ): Promise<boolean> {
    console.log(chalk.bold.cyan('\n📋 KẾT QUẢ PHÂN TÍCH VÀ LẬP KẾ HOẠCH (PLANNING COMPLETED):'));
    if (tasks.length > 0) {
      console.log(chalk.bold('  Danh sách nhiệm vụ dự kiến:'));
      for (const t of tasks) {
        console.log(`    • ${chalk.yellow.bold(`[${t.id}]`)} ${chalk.white.bold(t.title)}`);
        console.log(chalk.dim(`      Mô tả: ${t.description}`));
      }
    }
    if (architectureSummary) {
      console.log(chalk.dim(`  Chỉ dẫn kiến trúc: ${architectureSummary}`));
    }

    const confirmed = await this.askConfirmation(
      'Việc phân tích lấy yêu cầu đã xong. Bạn có đồng ý để thực hiện dev và test không?',
      true
    );

    return confirmed;
  }

  public static async confirmSelfHealing(
    retryCount: number,
    maxRetries: number,
    errorSummary: string
  ): Promise<boolean> {
    console.log(chalk.bold.yellow(`\n⚠️  BÁO CÁO LỖI KIỂM THỬ:`));
    console.log(chalk.red(`  ${errorSummary.slice(0, 300)}`));

    const confirmed = await this.askConfirmation(
      `Kiểm thử thất bại. Bạn có đồng ý kích hoạt Claude CLI tự sửa mã nguồn (Self-Healing lần ${retryCount + 1}/${maxRetries}) không?`,
      true
    );

    return confirmed;
  }
}
