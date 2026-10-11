#!/usr/bin/env node

import readline from 'readline';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import { settings, SUPPORTED_MODELS } from './config/settings.js';
import { Logger } from './core/logger.js';
import { StateManager } from './core/state-manager.js';
import { PTYManager } from './terminal/pty-manager.js';
import { buildDevTeamGraph } from './graph/builder.js';
import { HITL } from './core/hitl.js';
import { cliCompleter, historyManager } from './core/completer.js';
import { TokenTracker } from './core/token-tracker.js';

let activeRl: readline.Interface | null = null;

export function getPromptString(): string {
  const currentPath = settings.get().projectPath;
  const home = os.homedir();
  let displayPath = currentPath;
  if (currentPath === home) {
    displayPath = '~';
  } else if (currentPath.startsWith(home)) {
    displayPath = '~' + currentPath.slice(home.length);
  }
  return chalk.cyan.bold('devteam') + chalk.dim(` [${displayPath}]`) + chalk.cyan.bold('> ');
}

export function updatePrompt(): void {
  if (activeRl) {
    activeRl.setPrompt(getPromptString());
  }
}

function printStatus(): void {
  const cfg = settings.get();
  const stateMgr = new StateManager(cfg.projectPath);
  const plan = stateMgr.getPlan();

  const modelInfo = SUPPORTED_MODELS.find((m) => m.name === cfg.model);
  const modelDisplay = modelInfo
    ? `${chalk.bold.yellow(cfg.model)} ${chalk.dim(`(9router: ${modelInfo.upstream} | ctx ${modelInfo.context} · max ${modelInfo.output})`)}`
    : chalk.bold.yellow(cfg.model);

  Logger.divider();
  console.log(chalk.bold.cyan('📊 TRẠNG THÁI HIỆN TẠI (SYSTEM STATUS):'));
  console.log(`  • ${chalk.bold('File Config:')}   ${chalk.dim(cfg.configFilePath)}`);
  console.log(`  • ${chalk.bold('Provider:')}      ${chalk.green(cfg.provider)} (${cfg.providerUrl})`);
  console.log(`  • ${chalk.bold('Model:')}         ${modelDisplay}`);
  console.log(
    `  • ${chalk.bold('API Key:')}       ${
      cfg.apiKey ? chalk.green('✓ Đã cấu hình (' + cfg.apiKey.slice(0, 7) + '...)') : chalk.red('✖ Chưa cấu hình')
    }`
  );
  console.log(
    `  • ${chalk.bold('Human-in-Loop:')} ${
      cfg.autoConfirm
        ? chalk.yellow('✖ TẮT (Tự động duyệt mọi bước)')
        : chalk.green('✓ BẬT (Xác nhận trước khi Dev & Test)')
    }`
  );
  const isHome = settings.isHomeDirectory();
  const projectDisplay = isHome
    ? `${chalk.yellowBright(cfg.projectPath)} ${chalk.red.bold('⚠️ (Thư mục cá nhân ~ | Cần dùng /project để chọn dự án!)')}`
    : chalk.blueBright(cfg.projectPath);

  console.log(`  • ${chalk.bold('Dự án (CWD):')}   ${projectDisplay}`);

  const tracker = TokenTracker.getInstance();
  const sessionMetrics = tracker.getSessionMetrics();
  const sessionCost = tracker.calculateCost(sessionMetrics.promptTokens, sessionMetrics.completionTokens);
  const pricing = tracker.getPricing();
  const ctxUsed = sessionMetrics.totalTokens;
  const ctxLimit = pricing.contextWindow;
  const ctxPct = ((ctxUsed / ctxLimit) * 100).toFixed(2);

  console.log(
    `  • ${chalk.bold('Token đã dùng:')}  ${chalk.bold.green(tracker.formatNumber(sessionMetrics.totalTokens))} tokens ` +
      chalk.dim(`(${tracker.formatNumber(sessionMetrics.promptTokens)} prompt · ${tracker.formatNumber(sessionMetrics.completionTokens)} completion · ${sessionMetrics.callsCount} lượt gọi)`)
  );
  console.log(
    `  • ${chalk.bold('Chi phí ước tính:')} ${chalk.bold.yellow(tracker.formatCost(sessionCost.costUSD, sessionCost.costVND))}`
  );
  console.log(
    `  • ${chalk.bold('Context Window:')} ${chalk.green(`${tracker.formatTokensCompact(ctxUsed)} / ${tracker.formatTokensCompact(ctxLimit)} tokens`)} ` +
      chalk.dim(`(${ctxPct}% đã dùng · Tình trạng: An toàn, không lo tràn context)`)
  );
  console.log(`  • ${chalk.bold('Tiến trình:')}    ${chalk.magenta(plan.currentPhase)}`);

  const activeTask = plan.tasks.find(
    (t) => t.status === 'IN_PROGRESS' || t.status === 'TESTING' || t.status === 'SELF_HEALING'
  );
  if (activeTask) {
    console.log(
      `  • ${chalk.bold('Đang xử lý:')}   ${chalk.yellow.bold(`[${activeTask.id}]`)} ${activeTask.title}`
    );
  }

  const ptySessions = PTYManager.getInstance().getActiveSessions();
  if (ptySessions.length > 0) {
    console.log(`  • ${chalk.bold('Terminals PTY:')}`);
    for (const s of ptySessions) {
      const statusTag = s.isAlive ? chalk.green('[RUNNING]') : chalk.gray('[STOPPED]');
      console.log(
        `    ${statusTag} ${chalk.bold.yellow(s.name)} (PID: ${s.pid}) - ${s.command} ${s.args.slice(0, 3).join(' ')}`
      );
    }
  } else {
    console.log(`  • ${chalk.bold('Terminals PTY:')}  ${chalk.dim('Chưa có terminal ngầm nào (IDLE)')}`);
  }

  if (plan.tasks.length > 0) {
    console.log(`\n  ${chalk.bold('Danh sách nhiệm vụ (.devteam/tasks):')}`);
    for (const t of plan.tasks) {
      let statusColor = chalk.gray;
      if (t.status === 'DONE') statusColor = chalk.green;
      else if (t.status === 'IN_PROGRESS' || t.status === 'TESTING') statusColor = chalk.yellow;
      else if (t.status === 'SELF_HEALING') statusColor = chalk.red;

      console.log(`    [${statusColor(t.status)}] ${chalk.bold(t.id)}: ${t.title} (retries: ${t.retryCount})`);
    }
  } else {
    console.log(chalk.dim('  (Chưa có nhiệm vụ nào. Nhập yêu cầu để bắt đầu phân tích)'));
  }
  Logger.divider();
}

function printHelp(): void {
  Logger.divider();
  console.log(chalk.bold.cyan('📖 BẢNG TRA CỨU CÁC LỆNH (COMMAND REFERENCE):'));
  console.log(`  ${chalk.yellow('/provider <tên> [url]')}   : Chọn AI Provider (9router, openrouter, anthropic, openai)`);
  console.log(`  ${chalk.yellow('/api-key <key>')}          : Cấu hình API Key (sk-...) -> Tự lưu vào config.json`);
  console.log(`  ${chalk.yellow('/project <đường_dẫn>')}     : Mở/chọn thư mục dự án (hỗ trợ hieukq/desktop/du-an-1, ~)`);
  console.log(`  ${chalk.yellow('/model [tên_model]')}      : Đổi model (gemini [mặc định], claude-sonnet) hoặc xem danh sách`);
  console.log(`  ${chalk.yellow('/autoconfirm [on|off]')}   : Bật/tắt tự động duyệt (mặc định tắt: hỏi xác nhận HITL)`);
  console.log(`  ${chalk.yellow('/status')}                 : Xem cấu hình, model hiện tại, dự án và tiến độ`);
  console.log(`  ${chalk.yellow('/tokens | /cost')}         : Xem footer thống kê chi tiết token đã dùng & ước tính chi phí`);
  console.log(`  ${chalk.yellow('/tasks')}                  : Xem danh sách task chi tiết`);
  console.log(`  ${chalk.yellow('/logs')}                   : Xem logs từ Terminal chạy ngầm (Claude CLI & Test Runner)`);
  console.log(`\n${chalk.bold.cyan('💻 LỆNH TERMINAL TRỰC TIẾP (DIRECT SHELL COMMANDS):')}`);
  console.log(`  ${chalk.yellow('cd <thư_mục>')}            : Di chuyển thư mục (ví dụ: cd du-an-1, cd ~, cd ..)`);
  console.log(`  ${chalk.yellow('pwd')}                     : Xem thư mục làm việc hiện tại`);
  console.log(`  ${chalk.yellow('ls, cat, git, npm, ...')}  : Chạy trực tiếp bất kỳ lệnh shell nào trên dự án`);
  console.log(`  ${chalk.yellow('!<lệnh> | $<lệnh>')}       : Thực thi lệnh shell cưỡng bức`);

  console.log(`\n${chalk.bold.cyan('🤖 ĐIỀU PHỐI AI (MULTI-AGENT ORCHESTRATION):')}`);
  console.log(`  ${chalk.yellow('<chào hỏi / chém gió>')}   : Trò chuyện xã giao với DevTeam AI (ví dụ: hello, bạn là ai)`);
  console.log(`  ${chalk.yellow('<tìm hiểu dự án>')}        : Khảo sát kiến trúc (ví dụ: dự án này có gì, tech stack là gì)`);
  console.log(`  ${chalk.yellow('<yêu cầu tính năng>')}     : Tự động phân tích PO -> Architect -> Xác nhận -> Dev -> Test`);
  console.log(`  ${chalk.yellow('/run <yêu cầu>')}          : Chạy workflow phát triển tính năng tường minh`);
  console.log(`  ${chalk.yellow('stop | /stop')}            : Dừng an toàn các terminal chạy ngầm và lưu checkpoint`);
  console.log(`  ${chalk.yellow('/exit | /quit')}           : Thoát khỏi chương trình`);

  console.log(`\n${chalk.bold.cyan('⚙️  CẤU HÌNH FILE (CONFIG FILE):')}`);
  console.log(`  File ${chalk.bold('config.json')} được lưu tại thư mục làm việc hoặc ~/.devteam/config.json.`);
  console.log(`  Cấu trúc file cấu hình tối giản (chỉ gồm 3 trường):`);
  console.log(chalk.dim(`  {
    "provider": "9router",
    "model": "gemini",
    "apiKey": "sk-your-api-key"
  }`));

  console.log(`\n${chalk.bold.cyan('🤖 2 COMBO MODEL CỦA 9ROUTER HIỆN TẠI:')}`);
  for (const m of SUPPORTED_MODELS) {
    const isDef = m.isDefault ? chalk.green(' [Mặc định]') : '';
    console.log(`  • ${chalk.bold.yellow(m.name)}${isDef}: trỏ tới ${chalk.cyan(m.upstream)} (ctx ${m.context} · max ${m.output})`);
  }

  console.log(chalk.dim('\n  Mẹo: Nhấn phím <Tab> để tự động điền tên dự án (du-an-1...), đường dẫn hoặc lệnh slash.'));
  console.log(chalk.dim('  Mẹo: Bạn có thể gõ gộp: `/provider 9router /api-key sk-xxxx /project hieukq/desktop/du-an-1`'));
  Logger.divider();
}

let isExecuting = false;

async function runFeatureDev(intent: string): Promise<void> {
  const cfg = settings.get();

  if (!cfg.apiKey) {
    Logger.error('Chưa có API Key! Hãy dùng lệnh: `/api-key sk-...` trước khi chạy.');
    return;
  }

  isExecuting = true;
  TokenTracker.getInstance().startTurn();

  try {
    const graph = buildDevTeamGraph();
    const result = await graph.invoke({
      intent,
      requestType: 'DEV',
      projectPath: cfg.projectPath,
      currentPhase: 'IDLE',
      tasks: [],
      retryCount: 0,
      isComplete: false,
      messages: [],
    });

    if (result.requestType === 'DEV') {
      Logger.divider();
      if (result.isComplete && result.currentPhase === 'DONE' && !result.error) {
        Logger.success('🎉 HOÀN TẤT TÍNH NĂNG VÀ TOÀN BỘ KIỂM THỬ ĐÃ ĐƯỢC XÁC THỰC!');
      } else if (result.error) {
        Logger.error(`Quy trình dừng lại với thông báo: ${result.error}`);
      } else {
        Logger.warn(`Trạng thái hiện tại: ${result.currentPhase}`);
      }
      Logger.divider();
    }
  } catch (err: any) {
    Logger.error(`Lỗi trong quá trình điều phối: ${err.message}`);
  } finally {
    isExecuting = false;
    TokenTracker.getInstance().printFooter();
  }
}

const SHELL_COMMAND_NAMES = new Set([
  'ls', 'dir', 'll', 'pwd', 'cat', 'mkdir', 'rmdir', 'touch', 'rm', 'cp', 'mv',
  'git', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'node', 'python', 'python3',
  'pip', 'pip3', 'pytest', 'cargo', 'go', 'make', 'curl', 'wget', 'docker',
  'docker-compose', 'which', 'echo', 'chmod', 'chown', 'diff', 'grep', 'find',
  'tree', 'head', 'tail', 'sed', 'awk', 'tar', 'zip', 'unzip', 'ps', 'kill',
  'env', 'export', 'code', 'nano', 'vim', 'vi', 'open', 'pbcopy', 'pbpaste',
  'df', 'du', 'free', 'uname', 'whoami', 'history', 'wc', 'sort', 'uniq',
  'less', 'more', 'source', 'sh', 'bash', 'zsh', 'clear'
]);

let previousDir: string | null = null;

export function handleCd(rawArg: string): boolean {
  const arg = rawArg.trim().replace(/^['"]|['"]$/g, '');
  const currentProject = settings.get().projectPath;
  const homeDir = os.homedir();

  let targetPath = '';

  if (!arg || arg === '~') {
    targetPath = homeDir;
  } else if (arg === '-') {
    if (!previousDir) {
      console.error(chalk.red('cd: OLDPWD not set'));
      return false;
    }
    targetPath = previousDir;
  } else if (arg === '..') {
    targetPath = path.dirname(currentProject);
  } else if (path.isAbsolute(arg)) {
    targetPath = path.normalize(arg);
  } else if (arg.startsWith('~/')) {
    targetPath = path.normalize(path.join(homeDir, arg.slice(2)));
  } else {
    // Relative path resolution:
    // 1. Try directly relative to current project path
    const candidate1 = path.resolve(currentProject, arg);
    if (fs.existsSync(candidate1)) {
      targetPath = candidate1;
    } else {
      // 2. Try relative to user home directory
      const candidate2 = path.resolve(homeDir, arg);
      if (fs.existsSync(candidate2)) {
        targetPath = candidate2;
      } else {
        // 3. Try inside ~/Desktop or ~/desktop
        const candidate3 = path.resolve(homeDir, 'Desktop', arg);
        const candidate3Lower = path.resolve(homeDir, 'desktop', arg);
        if (fs.existsSync(candidate3)) {
          targetPath = candidate3;
        } else if (fs.existsSync(candidate3Lower)) {
          targetPath = candidate3Lower;
        } else {
          // 4. Try inside ~/workspace
          const candidate4 = path.resolve(homeDir, 'workspace', arg);
          if (fs.existsSync(candidate4)) {
            targetPath = candidate4;
          } else {
            console.error(chalk.red(`cd: no such file or directory: ${arg}`));
            return false;
          }
        }
      }
    }
  }

  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      console.error(chalk.red(`cd: not a directory: ${arg}`));
      return false;
    }

    previousDir = currentProject;
    settings.setProjectPath(targetPath);
    historyManager.addWord(path.basename(targetPath));
    historyManager.addWord(arg);
    try {
      process.chdir(targetPath);
    } catch {}

    updatePrompt();
    return true;
  } catch (err: any) {
    console.error(chalk.red(`cd: ${err.message}`));
    return false;
  }
}

export function runShellCommand(commandLine: string, cwd: string): boolean {
  try {
    const res = spawnSync(commandLine, {
      shell: true,
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        FORCE_COLOR: '1',
      },
    });
    return res.status === 0;
  } catch (err: any) {
    console.error(chalk.red(`Lỗi thực thi lệnh: ${err.message}`));
    return false;
  }
}

export function isShellCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  if (!trimmed) return false;

  // Explicit shell escapes
  if (trimmed.startsWith('!') || trimmed.startsWith('$')) {
    return true;
  }

  // Executable paths
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return true;
  }

  // cd or pwd
  if (trimmed === 'cd' || trimmed.startsWith('cd ') || trimmed === 'pwd' || trimmed.startsWith('pwd ')) {
    return true;
  }

  // Extract first word
  const firstWord = trimmed.split(/[\s|;&><]+/)[0].toLowerCase();
  if (SHELL_COMMAND_NAMES.has(firstWord)) {
    // Edge case: English natural language using 'make' or 'find'
    if (firstWord === 'make' && /\b(a|an|the|me|new|component|function|page|feature)\b/i.test(trimmed)) {
      return false;
    }
    if (firstWord === 'find' && /\b(all|the|my|errors|bugs|issues|problems|function|classes|out)\b/i.test(trimmed)) {
      return false;
    }
    return true;
  }

  // Compound commands
  if (trimmed.includes('&&') || trimmed.includes(';')) {
    const firstPart = trimmed.split(/&&|;/)[0].trim();
    if (isShellCommand(firstPart)) {
      return true;
    }
  }

  return false;
}

export function executeShellPipeline(rawLine: string): boolean {
  let line = rawLine.trim();
  if (line.startsWith('!') || line.startsWith('$')) {
    line = line.slice(1).trim();
  }

  if (line === 'clear') {
    console.clear();
    return true;
  }

  if (line === 'pwd') {
    console.log(settings.get().projectPath);
    return true;
  }

  if (line === 'cd' || line.startsWith('cd ')) {
    handleCd(line.slice(2).trim());
    return true;
  }

  if (line.includes('&&') || line.includes(';')) {
    const separator = line.includes('&&') ? '&&' : ';';
    const parts = line.split(separator);
    for (const part of parts) {
      const sub = part.trim();
      if (!sub) continue;
      if (sub === 'cd' || sub.startsWith('cd ')) {
        const ok = handleCd(sub.slice(2).trim());
        if (!ok && separator === '&&') return true;
      } else if (sub === 'pwd') {
        console.log(settings.get().projectPath);
      } else {
        const ok = runShellCommand(sub, settings.get().projectPath);
        if (!ok && separator === '&&') return true;
      }
    }
    return true;
  }

  runShellCommand(line, settings.get().projectPath);
  return true;
}

export async function checkProjectIntent(input: string): Promise<boolean> {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  let candidateDir = '';
  let remainingIntent = '';

  // Pattern 1: starts with cd <folder> <natural language...> (e.g. "cd du-an-1 chúng ta phát triển dự án này")
  if (lower.startsWith('cd ')) {
    const afterCd = trimmed.slice(3).trim();
    const tokens = afterCd.split(/\s+/);
    if (tokens.length > 1) {
      const possibleFolder = tokens[0].replace(/^['"]|['"]$/g, '');
      const resolved = settings.resolveProjectPath(possibleFolder);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        candidateDir = resolved;
        remainingIntent = tokens.slice(1).join(' ').trim();
      }
    }
  }

  // Pattern 2: "chuyển sang / chuyển qua / phát triển / mở dự án <folder> [ý định]"
  if (!candidateDir) {
    const match = trimmed.match(
      /^(?:chuyển\s+(?:sang|qua)|phát\s+triển|mở)\s+(?:dự\s+án\s+|project\s+)?([^\s]+)(?:\s+(.*))?$/i
    );
    if (match) {
      const possibleFolder = match[1].replace(/^['"]|['"]$/g, '');
      const resolved = settings.resolveProjectPath(possibleFolder);
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        candidateDir = resolved;
        remainingIntent = (match[2] || '').trim();
      }
    }
  }

  // Pattern 3: Input is just a project name / folder path (e.g. "du-an-1" or "desktop/du-an-1")
  if (!candidateDir) {
    const tokens = trimmed.split(/\s+/);
    // 1-2 words, doesn't start with slash, not a known shell command keyword
    if (tokens.length <= 2 && !trimmed.startsWith('/') && !SHELL_COMMAND_NAMES.has(tokens[0].toLowerCase())) {
      const resolved = settings.resolveProjectPath(trimmed.replace(/^['"]|['"]$/g, ''));
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        // Exclude root home directory
        if (path.normalize(resolved) !== path.normalize(os.homedir())) {
          candidateDir = resolved;
          remainingIntent = '';
        }
      }
    }
  }

  if (!candidateDir) {
    return false;
  }

  const folderName = path.basename(candidateDir);

  // Ask human confirmation
  const confirmed = await HITL.askConfirmation(
    `Bạn muốn phát triển dự án "${folderName}" (${candidateDir}) đúng không?`,
    true
  );

  if (confirmed) {
    settings.setProjectPath(candidateDir);
    historyManager.addWord(folderName);
    historyManager.addWord(candidateDir);
    updatePrompt();
    Logger.success(`Đã chuyển sang dự án: ${chalk.bold.blueBright(candidateDir)} (Đã cập nhật file config)`);

    const isGeneric =
      !remainingIntent ||
      /^(chúng\s+ta\s+)?phát\s+triển\s+(dự\s+án\s+này|project\s+này)$/i.test(remainingIntent) ||
      /^này$/i.test(remainingIntent);

    if (!isGeneric && remainingIntent) {
      await runFeatureDev(remainingIntent);
    } else {
      console.log(chalk.cyan(`\n👉 Hãy cho tôi biết tính năng hoặc yêu cầu bạn muốn phát triển trong dự án "${folderName}":\n`));
    }
    return true;
  } else {
    console.log(chalk.yellow('\nTôi chưa rõ đây là gì, bạn hãy nói ý định của mình.\n'));
    return true;
  }
}

function isCommandKeyword(token: string): boolean {
  const t = token.toLowerCase().replace(/^\/+/, '');
  return [
    'provider',
    'api-key', 'apikey',
    'project',
    'model',
    'autoconfirm',
    'status',
    'tokens', 'token',
    'cost', 'estimate',
    'tasks',
    'logs',
    'run',
    'help',
    'stop',
    'exit', 'quit', 'q', 'ẽit',
    'cat', 'config'
  ].includes(t);
}

export async function processCommandLine(line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  const normalizedCmd = lower.replace(/^\/+/, '');

  // Stop - always available even while executing
  if (normalizedCmd === 'stop') {
    PTYManager.getInstance().killAll();
    const cfg = settings.get();
    const stateMgr = new StateManager(cfg.projectPath);
    stateMgr.pause();
    isExecuting = false;
    Logger.success('Đã dừng an toàn tất cả các tiến trình terminal ngầm.');
    Logger.info(`Đã lưu checkpoint trạng thái tại: ${chalk.bold(path.join(cfg.projectPath, '.devteam/MASTER_PLAN.json'))}`);
    return true;
  }

  // Concurrency guard: if already executing, prevent running other commands
  if (isExecuting) {
    Logger.warn('⚠️  Một quy trình phát triển tính năng đang chạy. Hãy gõ `stop` nếu bạn muốn dừng lại.');
    return true;
  }

  // Exit / Quit (supports /exit, exit, quit, q, and Vietnamese typos like //ẽit)
  if (
    normalizedCmd === 'exit' ||
    normalizedCmd === 'quit' ||
    normalizedCmd === 'q' ||
    normalizedCmd === 'ẽit'
  ) {
    PTYManager.getInstance().killAll();
    console.log(chalk.cyan('Tạm biệt! Hẹn gặp lại. 👋'));
    return false;
  }

  // Autoconfirm
  if (normalizedCmd === 'autoconfirm' || normalizedCmd.startsWith('autoconfirm ')) {
    const parts = trimmed.split(/\s+/);
    if (parts.length > 1) {
      const mode = parts[1].toLowerCase();
      if (mode === 'on' || mode === 'true' || mode === '1') {
        settings.setAutoConfirm(true);
        Logger.warn('Đã BẬT Auto-Confirm (Bỏ qua câu hỏi Human-in-the-Loop, tự động duyệt mọi bước).');
      } else if (mode === 'off' || mode === 'false' || mode === '0') {
        settings.setAutoConfirm(false);
        Logger.success('Đã TẮT Auto-Confirm (BẬT Human-in-the-Loop, sẽ hỏi xác nhận trước khi Dev & Test).');
      } else {
        Logger.warn('Cú pháp: autoconfirm on | autoconfirm off');
      }
    } else {
      const cur = settings.get().autoConfirm;
      Logger.info(`Chế độ Auto-Confirm hiện tại: ${cur ? chalk.yellow('BẬT (Tự duyệt)') : chalk.green('TẮT (Hỏi xác nhận HITL)')}`);
      console.log(chalk.dim('  Dùng `autoconfirm on` hoặc `autoconfirm off` để thay đổi.'));
    }
    return true;
  }

  // Help
  if (normalizedCmd === 'help') {
    printHelp();
    return true;
  }

  // Status
  if (normalizedCmd === 'status') {
    printStatus();
    return true;
  }

  // Tokens / Cost / Estimate
  if (
    normalizedCmd === 'tokens' ||
    normalizedCmd === 'token' ||
    normalizedCmd === 'cost' ||
    normalizedCmd === 'estimate'
  ) {
    TokenTracker.getInstance().printFooter();
    return true;
  }

  // Tasks
  if (normalizedCmd === 'tasks') {
    const cfg = settings.get();
    const stateMgr = new StateManager(cfg.projectPath);
    const plan = stateMgr.getPlan();
    if (plan.tasks.length === 0) {
      Logger.info('Chưa có task nào.');
    } else {
      for (const t of plan.tasks) {
        console.log(`\n${chalk.bold.yellow(`[${t.id}] ${t.title}`)} - Trạng thái: ${t.status}`);
        console.log(`  Mô tả: ${t.description}`);
        console.log(`  Tiêu chí: ${t.acceptanceCriteria.join('; ')}`);
        if (t.lastError) {
          console.log(chalk.red(`  Lỗi gần nhất: ${t.lastError.slice(0, 150)}...`));
        }
      }
    }
    return true;
  }

  // Logs
  if (normalizedCmd === 'logs') {
    const logs = PTYManager.getInstance().getAllLogs();
    const keys = Object.keys(logs);
    if (keys.length === 0) {
      Logger.info('Chưa có logs terminal nào.');
    } else {
      for (const key of keys) {
        console.log(chalk.bold.cyan(`\n=== Terminal: ${key} ===`));
        console.log(logs[key] ? logs[key].slice(-1000) : chalk.dim('(Trống)'));
      }
    }
    return true;
  }

  // Config
  if (normalizedCmd === 'config' || trimmed === 'cat config' || trimmed === 'cat config.json') {
    const cfg = settings.get();
    console.log(chalk.bold.cyan(`\n📄 Cấu hình hiện tại (${cfg.configFilePath}):`));
    try {
      if (fs.existsSync(cfg.configFilePath)) {
        console.log(chalk.white(fs.readFileSync(cfg.configFilePath, 'utf-8')));
      } else {
        console.log(JSON.stringify({ provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey }, null, 2));
      }
    } catch {
      // ignore
    }
    return true;
  }

  // Run feature dev explicitly
  if (trimmed.startsWith('/run ') || trimmed.startsWith('run ')) {
    const intent = trimmed.replace(/^(\/run|run)\s+/, '').trim();
    if (intent) {
      await runFeatureDev(intent);
    } else {
      Logger.warn('Cú pháp: run <mô_tả_tính_năng>');
    }
    return true;
  }

  // Parse commands (supports both `/command` and `command`, and chained commands)
  const tokens = trimmed.split(/\s+/);
  let i = 0;
  let handledAny = false;

  while (i < tokens.length) {
    const token = tokens[i];
    const tokNorm = token.toLowerCase().replace(/^\/+/, '');

    if (tokNorm === 'provider') {
      const providerName = tokens[i + 1];
      if (providerName && !isCommandKeyword(providerName)) {
        const customUrl = tokens[i + 2] && !isCommandKeyword(tokens[i + 2]) ? tokens[i + 2] : undefined;
        settings.setProvider(providerName, customUrl);
        Logger.success(`Đã cấu hình Provider: ${chalk.bold(providerName)} (${settings.get().providerUrl})`);
        i += customUrl ? 3 : 2;
        handledAny = true;
        continue;
      } else {
        const cur = settings.get();
        Logger.info(`Provider hiện tại: ${chalk.bold.green(cur.provider)} (${cur.providerUrl})`);
        console.log(chalk.dim('  Cú pháp đổi provider: provider <tên> [url_tùy_chọn]\n'));
        i++;
        handledAny = true;
        continue;
      }
    }

    if (tokNorm === 'api-key' || tokNorm === 'apikey') {
      const key = tokens[i + 1];
      if (key && !isCommandKeyword(key)) {
        settings.setApiKey(key);
        const masked = key.length > 8 ? key.slice(0, 6) + '...' + key.slice(-4) : '***';
        Logger.success(`Đã cấu hình API Key: ${chalk.bold(masked)} (Lưu vào config.json)`);
        i += 2;
        handledAny = true;
        continue;
      } else {
        const curKey = settings.get().apiKey;
        if (curKey) {
          const masked = curKey.length > 8 ? curKey.slice(0, 6) + '...' + curKey.slice(-4) : '***';
          Logger.info(`API Key hiện tại: ${chalk.bold.green(masked)}`);
        } else {
          Logger.warn('Chưa cấu hình API Key. Cú pháp: api-key sk-...');
        }
        i++;
        handledAny = true;
        continue;
      }
    }

    if (tokNorm === 'project') {
      const rawPath = tokens[i + 1];
      if (rawPath && !isCommandKeyword(rawPath)) {
        const resolved = settings.setProjectPath(rawPath);
        historyManager.addWord(path.basename(resolved));
        historyManager.addWord(rawPath);
        updatePrompt();
        Logger.success(`Đã mở dự án tại: ${chalk.bold.blueBright(resolved)}`);
        const summary = fs.readdirSync(resolved);
        Logger.info(`Số lượng file/thư mục: ${summary.length} (${summary.slice(0, 8).join(', ') || 'thư mục mới'})`);
        i += 2;
        handledAny = true;
        continue;
      } else {
        const cur = settings.get();
        Logger.info(`Dự án hiện tại: ${chalk.bold.blueBright(cur.projectPath)}`);
        console.log(chalk.dim('  Cú pháp đổi dự án: project <đường_dẫn> (ví dụ: project desktop/du-an-1)\n'));
        i++;
        handledAny = true;
        continue;
      }
    }

    if (tokNorm === 'model') {
      const modelName = tokens[i + 1];
      if (modelName && !isCommandKeyword(modelName)) {
        settings.setModel(modelName);
        const found = SUPPORTED_MODELS.find((m) => m.name === modelName);
        const detail = found ? ` (9router: ${found.upstream})` : '';
        Logger.success(`Đã cấu hình Model: ${chalk.bold(modelName)}${detail} (Lưu vào config.json)`);
        i += 2;
        handledAny = true;
        continue;
      } else {
        console.log(`\n${chalk.bold.cyan('🤖 DANH SÁCH MODEL COMBO CỦA 9ROUTER:')}`);
        for (const m of SUPPORTED_MODELS) {
          const isCur = m.name === settings.get().model ? chalk.green(' [Đang chọn]') : '';
          console.log(`  • ${chalk.bold.yellow(m.name)}${isCur}: ${chalk.dim(m.upstream)} (ctx ${m.context} · max ${m.output})`);
        }
        console.log(chalk.dim('  Cú pháp đổi model: model gemini  hoặc  model claude-sonnet\n'));
        i++;
        handledAny = true;
        continue;
      }
    }

    i++;
  }

  if (handledAny) {
    return true;
  }

  // 1. Check for Project Intent & Confirmation (e.g. "cd du-an-1 chúng ta phát triển...", "du-an-1")
  if (await checkProjectIntent(trimmed)) {
    return true;
  }

  // 2. Shell Command Execution (Zero AI latency, runs directly on local project terminal)
  if (isShellCommand(trimmed)) {
    executeShellPipeline(trimmed);
    return true;
  }

  // 3. Any natural language text is handled by the AI Multi-Agent Orchestrator
  await runFeatureDev(trimmed);
  return true;
}

export async function startInteractiveCLI(showBanner: boolean = true): Promise<void> {
  if (showBanner) {
    Logger.banner();
  }
  printStatus();
  console.log(
    chalk.dim('  Nhập lệnh slash (ví dụ: /provider 9router /api-key sk-... /project hieukq/desktop/du-an-1)')
  );
  console.log(chalk.dim('  Hoặc cd du-an-1, ls, cat..., hoặc gõ trực tiếp yêu cầu dev. Gõ /help để xem trợ giúp.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPromptString(),
    completer: cliCompleter,
  });

  activeRl = rl;
  HITL.setInteractiveMode(true);

  rl.prompt();

  rl.on('line', async (line) => {
    historyManager.addLine(line);
    if (isExecuting || HITL.hasPendingQuestion()) {
      HITL.queueInput(line);
      return;
    }

    try {
      const shouldContinue = await processCommandLine(line);
      if (!shouldContinue) {
        HITL.setInteractiveMode(false);
        activeRl = null;
        rl.close();
        process.exit(0);
      }
    } catch (e: any) {
      Logger.error(`Lỗi: ${e.message}`);
    }

    // Process any queued commands that arrived while execution was busy
    while (!isExecuting && !HITL.hasPendingQuestion() && HITL.hasQueuedInput()) {
      const nextLine = HITL.popQueuedInput();
      if (nextLine !== undefined && nextLine.trim()) {
        try {
          const cont = await processCommandLine(nextLine);
          if (!cont) {
            HITL.setInteractiveMode(false);
            activeRl = null;
            rl.close();
            process.exit(0);
          }
        } catch (e: any) {
          Logger.error(`Lỗi: ${e.message}`);
        }
      }
    }

    // Only prompt when execution is idle and no HITL question is pending
    if (!isExecuting && !HITL.hasPendingQuestion()) {
      rl.prompt();
    }
  });

  rl.on('close', () => {
    activeRl = null;
    HITL.setInteractiveMode(false);
    PTYManager.getInstance().killAll();
    process.exit(0);
  });
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await startInteractiveCLI(true);
    return;
  }

  // Handle command line arguments
  const first = args[0];

  if (first === 'status') {
    Logger.banner();
    printStatus();
    return;
  }

  if (first === 'tokens' || first === 'cost') {
    Logger.banner();
    TokenTracker.getInstance().printFooter();
    return;
  }

  if (first === 'logs') {
    const logs = PTYManager.getInstance().getAllLogs();
    console.log(logs);
    return;
  }

  if (first === 'stop') {
    Logger.banner();
    PTYManager.getInstance().killAll();
    const cfg = settings.get();
    const stateMgr = new StateManager(cfg.projectPath);
    stateMgr.pause();
    Logger.success('Đã dừng an toàn tất cả các tiến trình terminal ngầm.');
    Logger.info(`Đã lưu checkpoint trạng thái tại: ${path.join(cfg.projectPath, '.devteam/MASTER_PLAN.json')}`);
    return;
  }

  if (first === 'run') {
    const intent = args.slice(1).join(' ');
    if (!intent) {
      Logger.error('Vui lòng nhập yêu cầu: devteam run "tính năng X"');
      process.exit(1);
    }
    Logger.banner();
    await runFeatureDev(intent);
    return;
  }

  // If arguments start with / (e.g. devteam /provider 9router /api-key ...)
  if (first.startsWith('/')) {
    Logger.banner();
    await processCommandLine(args.join(' '));
    // After running the setup command, drop into interactive CLI without duplicating banner
    await startInteractiveCLI(false);
    return;
  }

  // Fallback to interactive mode with given intent
  Logger.banner();
  await runFeatureDev(args.join(' '));
  await startInteractiveCLI(false);
}

const isDirectExecution =
  process.argv[1] &&
  (import.meta.url.endsWith(process.argv[1]) ||
    process.argv[1].endsWith('devteam') ||
    process.argv[1].endsWith('dist/cli.js') ||
    process.argv[1].endsWith('src/cli.ts'));

if (isDirectExecution) {
  main().catch((err) => {
    Logger.error(`Lỗi khởi động: ${err.message}`);
    process.exit(1);
  });
}
