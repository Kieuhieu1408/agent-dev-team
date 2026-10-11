#!/usr/bin/env node

import readline from 'readline';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { settings, SUPPORTED_MODELS } from './config/settings.js';
import { Logger } from './core/logger.js';
import { StateManager } from './core/state-manager.js';
import { PTYManager } from './terminal/pty-manager.js';
import { buildDevTeamGraph } from './graph/builder.js';
import { HITL } from './core/hitl.js';

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
  console.log(`  • ${chalk.bold('Tiến trình:')}    ${chalk.magenta(plan.currentPhase)}`);

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
  console.log(`  ${chalk.yellow('/tasks')}                  : Xem danh sách task chi tiết`);
  console.log(`  ${chalk.yellow('/logs')}                   : Xem logs từ Terminal chạy ngầm (Claude CLI & Test Runner)`);
  console.log(`  ${chalk.yellow('/run <yêu cầu>')}          : Chạy workflow phát triển tính năng`);
  console.log(`  ${chalk.yellow('<yêu cầu tính năng>')}     : Gõ trực tiếp yêu cầu bất kỳ để dev tính năng`);
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

  console.log(chalk.dim('\n  Mẹo: Bạn có thể gõ gộp: `/provider 9router /api-key sk-xxxx /project hieukq/desktop/du-an-1`'));
  Logger.divider();
}

let isExecuting = false;

async function runFeatureDev(intent: string): Promise<void> {
  const cfg = settings.get();

  if (!cfg.apiKey) {
    Logger.error('Chưa có API Key! Hãy dùng lệnh: `/api-key sk-...` trước khi chạy.');
    return;
  }

  if (settings.isHomeDirectory()) {
    Logger.error(`⛔ Không thể phát triển tính năng trực tiếp trên thư mục cá nhân (${cfg.projectPath})!`);
    console.log(chalk.yellow('\n👉 Hãy mở/chỉ định thư mục dự án bằng lệnh:'));
    console.log(chalk.bold.cyan('   /project <đường_dẫn>') + chalk.dim(' (Ví dụ: /project desktop/du-an-1)\n'));
    return;
  }

  isExecuting = true;
  Logger.divider();
  Logger.info(`Bắt đầu phát triển tính năng cho dự án: ${chalk.bold.blueBright(cfg.projectPath)}`);
  Logger.info(`Mục tiêu: "${chalk.bold.white(intent)}"`);
  Logger.divider();

  try {
    const graph = buildDevTeamGraph();
    const result = await graph.invoke({
      intent,
      projectPath: cfg.projectPath,
      currentPhase: 'IDLE',
      tasks: [],
      retryCount: 0,
      isComplete: false,
      messages: [],
    });

    Logger.divider();
    if (result.isComplete && result.currentPhase === 'DONE' && !result.error) {
      Logger.success('🎉 HOÀN TẤT TÍNH NĂNG VÀ TOÀN BỘ KIỂM THỬ ĐÃ ĐƯỢC XÁC THỰC!');
    } else if (result.error) {
      Logger.error(`Quy trình dừng lại với thông báo: ${result.error}`);
    } else {
      Logger.warn(`Trạng thái hiện tại: ${result.currentPhase}`);
    }
    Logger.divider();
  } catch (err: any) {
    Logger.error(`Lỗi trong quá trình điều phối: ${err.message}`);
  } finally {
    isExecuting = false;
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

  // Cat or Config
  if (normalizedCmd === 'config' || lower.startsWith('cat ')) {
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

  // If user entered text that is neither a recognized command nor 'run ...', inform clearly
  console.log(chalk.yellow(`\n⚠️  Không nhận diện được lệnh: "${trimmed}"`));
  console.log(chalk.dim('  • Hệ thống đang ở chế độ Cài đặt (Settings Mode). Gõ /help để xem trợ giúp.'));
  console.log(chalk.cyan(`  • Để BẮT ĐẦU PHÁT TRIỂN TÍNH NĂNG, vui lòng gõ: ${chalk.bold(`run ${trimmed}`)}\n`));
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
  console.log(chalk.dim('  Hoặc gõ trực tiếp yêu cầu tính năng cần dev. Gõ /help để xem trợ giúp.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan.bold('devteam> '),
  });

  HITL.setInteractiveMode(true);

  rl.prompt();

  rl.on('line', async (line) => {
    if (isExecuting || HITL.hasPendingQuestion()) {
      HITL.queueInput(line);
      return;
    }

    try {
      const shouldContinue = await processCommandLine(line);
      if (!shouldContinue) {
        HITL.setInteractiveMode(false);
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

main().catch((err) => {
  Logger.error(`Lỗi khởi động: ${err.message}`);
  process.exit(1);
});
