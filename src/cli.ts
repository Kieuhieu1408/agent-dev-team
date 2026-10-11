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
  console.log(`  • ${chalk.bold('File Config:')}  ${chalk.dim(cfg.configFilePath)}`);
  console.log(`  • ${chalk.bold('Provider:')}     ${chalk.green(cfg.provider)} (${cfg.providerUrl})`);
  console.log(`  • ${chalk.bold('Model:')}        ${modelDisplay}`);
  console.log(
    `  • ${chalk.bold('API Key:')}      ${
      cfg.apiKey ? chalk.green('✓ Đã cấu hình (' + cfg.apiKey.slice(0, 7) + '...)') : chalk.red('✖ Chưa cấu hình')
    }`
  );
  console.log(`  • ${chalk.bold('Dự án (CWD):')}  ${chalk.blueBright(cfg.projectPath)}`);
  console.log(`  • ${chalk.bold('Tiến trình:')}   ${chalk.magenta(plan.currentPhase)}`);

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
  console.log(`  ${chalk.yellow('/status')}                 : Xem cấu hình, model hiện tại, dự án và tiến độ`);
  console.log(`  ${chalk.yellow('/tasks')}                  : Xem danh sách task chi tiết`);
  console.log(`  ${chalk.yellow('/logs')}                   : Xem logs từ Terminal chạy ngầm (Claude CLI & Test Runner)`);
  console.log(`  ${chalk.yellow('/run <yêu cầu>')}          : Chạy workflow phát triển tính năng`);
  console.log(`  ${chalk.yellow('<yêu cầu tính năng>')}     : Gõ trực tiếp yêu cầu bất kỳ để dev tính năng`);
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

async function runFeatureDev(intent: string): Promise<void> {
  const cfg = settings.get();

  if (!cfg.apiKey) {
    Logger.error('Chưa có API Key! Hãy dùng lệnh: `/api-key sk-...` trước khi chạy.');
    return;
  }

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
  }
}

export async function processCommandLine(line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (!trimmed) return true;

  if (trimmed === '/exit' || trimmed === '/quit') {
    PTYManager.getInstance().killAll();
    console.log(chalk.cyan('Tạm biệt! Hẹn gặp lại. 👋'));
    return false;
  }

  if (trimmed === '/help') {
    printHelp();
    return true;
  }

  if (trimmed === '/status') {
    printStatus();
    return true;
  }

  if (trimmed === '/tasks') {
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

  if (trimmed === '/logs') {
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

  // Parse slash commands, including chained ones e.g. "/provider 9router /api-key sk-xxx /project du-an-1"
  if (trimmed.startsWith('/')) {
    const tokens = trimmed.split(/\s+/);
    let i = 0;
    let handledAny = false;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token === '/provider') {
        const providerName = tokens[i + 1];
        if (providerName && !providerName.startsWith('/')) {
          const customUrl = tokens[i + 2] && !tokens[i + 2].startsWith('/') ? tokens[i + 2] : undefined;
          settings.setProvider(providerName, customUrl);
          Logger.success(`Đã cấu hình Provider: ${chalk.bold(providerName)} (${settings.get().providerUrl})`);
          i += customUrl ? 3 : 2;
          handledAny = true;
          continue;
        } else {
          Logger.warn('Cú pháp: /provider <tên_provider> [url_tùy_chọn]');
          i++;
          continue;
        }
      }

      if (token === '/api-key') {
        const key = tokens[i + 1];
        if (key && !key.startsWith('/')) {
          settings.setApiKey(key);
          const masked = key.length > 8 ? key.slice(0, 6) + '...' + key.slice(-4) : '***';
          Logger.success(`Đã cấu hình API Key: ${chalk.bold(masked)}`);
          i += 2;
          handledAny = true;
          continue;
        } else {
          Logger.warn('Cú pháp: /api-key sk-...');
          i++;
          continue;
        }
      }

      if (token === '/project') {
        const rawPath = tokens[i + 1];
        if (rawPath && !rawPath.startsWith('/')) {
          const resolved = settings.setProjectPath(rawPath);
          Logger.success(`Đã mở dự án tại: ${chalk.bold.blueBright(resolved)}`);
          // Display project summary
          const summary = fs.readdirSync(resolved);
          Logger.info(`Số lượng file/thư mục: ${summary.length} (${summary.slice(0, 8).join(', ') || 'thư mục mới'})`);
          i += 2;
          handledAny = true;
          continue;
        } else {
          Logger.warn('Cú pháp: /project <đường_dẫn>');
          i++;
          continue;
        }
      }

      if (token === '/model') {
        const modelName = tokens[i + 1];
        if (modelName && !modelName.startsWith('/')) {
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
          console.log(chalk.dim('  Cú pháp đổi model: /model gemini  hoặc  /model claude-sonnet\n'));
          i++;
          handledAny = true;
          continue;
        }
      }

      if (token === '/run') {
        const intent = tokens.slice(i + 1).join(' ');
        if (intent.trim()) {
          await runFeatureDev(intent.trim());
        } else {
          Logger.warn('Cú pháp: /run <mô_tả_tính_năng>');
        }
        return true;
      }

      // If we don't recognize the token but it starts with /, warn
      if (token.startsWith('/') && !handledAny) {
        Logger.warn(`Không nhận diện được lệnh: ${token}. Gõ /help để xem hướng dẫn.`);
      }
      i++;
    }

    if (handledAny) {
      return true;
    }
  }

  // If not a slash command, treat as intent to develop
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
  console.log(chalk.dim('  Hoặc gõ trực tiếp yêu cầu tính năng cần dev. Gõ /help để xem trợ giúp.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan.bold('devteam> '),
  });

  rl.prompt();

  rl.on('line', async (line) => {
    try {
      const shouldContinue = await processCommandLine(line);
      if (!shouldContinue) {
        rl.close();
        process.exit(0);
      }
    } catch (e: any) {
      Logger.error(`Lỗi: ${e.message}`);
    }
    rl.prompt();
  });

  rl.on('close', () => {
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
