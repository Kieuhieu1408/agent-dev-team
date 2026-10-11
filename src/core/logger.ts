import chalk from 'chalk';
import * as p from '@clack/prompts';

export class Logger {
  public static banner(): void {
    console.log(
      chalk.cyan(`
  ██████╗ ███████╗██╗   ██╗████████╗███████╗ █████╗ ███╗   ███╗
  ██╔══██╗██╔════╝██║   ██║╚══██╔══╝██╔════╝██╔══██╗████╗ ████║
  ██║  ██║█████╗  ██║   ██║   ██║   █████╗  ███████║██╔████╔██║
  ██║  ██║██╔══╝  ╚██╗ ██╔╝   ██║   ██╔══╝  ██╔══██║██║╚██╔╝██║
  ██████╔╝███████╗ ╚████╔╝    ██║   ███████╗██║  ██║██║ ╚═╝ ██║
  ╚═════╝ ╚══════╝  ╚═══╝     ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝
    `)
    );
    console.log(
      chalk.bold.hex('#00E5FF')(
        '  🚀 Terminal-First Multi-Agent Orchestrator | Closed-Loop Self-Healing'
      )
    );
    console.log(
      chalk.dim('  ' + '─'.repeat(68))
    );
  }

  public static info(message: string): void {
    console.log(`${chalk.blue('ℹ')} ${message}`);
  }

  public static success(message: string): void {
    console.log(`${chalk.green('✔')} ${chalk.bold.green(message)}`);
  }

  public static warn(message: string): void {
    console.log(`${chalk.yellow('▲')} ${chalk.yellow(message)}`);
  }

  public static error(message: string): void {
    console.log(`${chalk.red('✖')} ${chalk.bold.red(message)}`);
  }

  public static agentMessage(agent: string, message: string): void {
    const badges: Record<string, string> = {
      PO: chalk.bgBlue.bold.white(' 📋 Product Owner '),
      Architect: chalk.bgMagenta.bold.white(' 🏛️  Architect   '),
      Dev: chalk.bgCyan.bold.black(' 💻 Dev Worker   '),
      Tester: chalk.bgYellow.bold.black(' 🧪 Test Runner  '),
      Orchestrator: chalk.bgGreen.bold.black(' ⚡ Orchestrator '),
    };
    const badge = badges[agent] || chalk.bgGray.bold.white(` [${agent}] `);
    console.log(`\n${badge} ${chalk.white(message)}`);
  }

  public static ptyOutput(terminalName: string, data: string): void {
    const trimmed = data.trim();
    if (!trimmed) return;
    const prefix = chalk.dim(`[${terminalName}] `);
    const lines = trimmed.split('\n');
    for (const line of lines) {
      console.log(`${prefix}${chalk.gray(line)}`);
    }
  }

  public static spinner(): {
    start: (msg: string) => void;
    stop: (msg: string) => void;
    message: (msg: string) => void;
  } {
    return p.spinner();
  }

  public static divider(): void {
    console.log(chalk.dim('─'.repeat(70)));
  }
}
