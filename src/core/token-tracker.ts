import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { settings } from '../config/settings.js';

export interface ModelPricing {
  inputPerMillionUSD: number;
  outputPerMillionUSD: number;
  contextWindow: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  gemini: {
    inputPerMillionUSD: 1.25,
    outputPerMillionUSD: 5.0,
    contextWindow: 1_000_000,
  },
  'claude-sonnet': {
    inputPerMillionUSD: 3.0,
    outputPerMillionUSD: 15.0,
    contextWindow: 1_000_000,
  },
  openai: {
    inputPerMillionUSD: 2.5,
    outputPerMillionUSD: 10.0,
    contextWindow: 128_000,
  },
  default: {
    inputPerMillionUSD: 1.5,
    outputPerMillionUSD: 6.0,
    contextWindow: 1_000_000,
  },
};

const USD_TO_VND_RATE = 25400;

export interface TokenUsageMetrics {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callsCount: number;
}

export interface ProjectPersistentStats {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCalls: number;
  totalCostUSD: number;
  lastUpdated: string;
}

export class TokenTrackerCallbackHandler extends BaseCallbackHandler {
  name = 'TokenTrackerCallbackHandler';
  private tracker: TokenTracker;
  private lastPromptCharCount: number = 0;

  constructor(tracker: TokenTracker) {
    super();
    this.tracker = tracker;
  }

  override async handleLLMStart(_llm: any, prompts: string[]) {
    this.lastPromptCharCount = prompts.reduce((sum, p) => sum + (p ? p.length : 0), 0);
  }

  override async handleLLMEnd(output: any) {
    let promptTokens = 0;
    let completionTokens = 0;

    // 1. Check llmOutput?.tokenUsage (standard LangChain / OpenAI format)
    if (output?.llmOutput?.tokenUsage) {
      const u = output.llmOutput.tokenUsage;
      promptTokens = u.promptTokens ?? u.prompt_tokens ?? 0;
      completionTokens = u.completionTokens ?? u.completion_tokens ?? 0;
    }

    // 2. Check message.usage_metadata
    if (!promptTokens && output?.generations?.[0]?.[0]?.message?.usage_metadata) {
      const meta = output.generations[0][0].message.usage_metadata;
      promptTokens = meta.input_tokens ?? 0;
      completionTokens = meta.output_tokens ?? 0;
    }

    // 3. Check response_metadata
    if (!promptTokens && output?.generations?.[0]?.[0]?.message?.response_metadata) {
      const resMeta = output.generations[0][0].message.response_metadata;
      const usage = resMeta.tokenUsage || resMeta.usage;
      if (usage) {
        promptTokens = usage.promptTokens ?? usage.prompt_tokens ?? 0;
        completionTokens = usage.completionTokens ?? usage.completion_tokens ?? 0;
      }
    }

    // 4. Fallback estimation if endpoint returns 0 or no metadata (~4 chars/token)
    if (promptTokens === 0 && this.lastPromptCharCount > 0) {
      promptTokens = Math.max(1, Math.round(this.lastPromptCharCount / 4));
    }
    if (completionTokens === 0) {
      const genText = output?.generations?.[0]?.[0]?.text || '';
      if (genText.length > 0) {
        completionTokens = Math.max(1, Math.round(genText.length / 4));
      }
    }

    this.tracker.recordUsage(promptTokens, completionTokens, 'LangChain LLM');
  }
}

export class TokenTracker {
  private static instance: TokenTracker;

  private turnMetrics: TokenUsageMetrics = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    callsCount: 0,
  };

  private sessionMetrics: TokenUsageMetrics = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    callsCount: 0,
  };

  private callbackHandler: TokenTrackerCallbackHandler;

  private constructor() {
    this.callbackHandler = new TokenTrackerCallbackHandler(this);
  }

  public static getInstance(): TokenTracker {
    if (!TokenTracker.instance) {
      TokenTracker.instance = new TokenTracker();
    }
    return TokenTracker.instance;
  }

  public createCallbackHandler(): TokenTrackerCallbackHandler {
    return this.callbackHandler;
  }

  public startTurn(): void {
    this.turnMetrics = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callsCount: 0,
    };
  }

  public recordUsage(promptTokens: number, completionTokens: number, _source?: string): void {
    const total = promptTokens + completionTokens;
    this.turnMetrics.promptTokens += promptTokens;
    this.turnMetrics.completionTokens += completionTokens;
    this.turnMetrics.totalTokens += total;
    this.turnMetrics.callsCount += 1;

    this.sessionMetrics.promptTokens += promptTokens;
    this.sessionMetrics.completionTokens += completionTokens;
    this.sessionMetrics.totalTokens += total;
    this.sessionMetrics.callsCount += 1;

    this.persistProjectStats(promptTokens, completionTokens);
  }

  public getPricing(): ModelPricing {
    const model = (settings.get().model || 'gemini').toLowerCase();
    if (model.includes('claude') || model.includes('sonnet')) {
      return MODEL_PRICING['claude-sonnet'];
    }
    if (model.includes('gemini')) {
      return MODEL_PRICING['gemini'];
    }
    if (model.includes('gpt')) {
      return MODEL_PRICING['openai'];
    }
    return MODEL_PRICING.default;
  }

  public calculateCost(promptTokens: number, completionTokens: number): { costUSD: number; costVND: number } {
    const pricing = this.getPricing();
    const costUSD =
      (promptTokens * pricing.inputPerMillionUSD + completionTokens * pricing.outputPerMillionUSD) / 1_000_000;
    const costVND = Math.round(costUSD * USD_TO_VND_RATE);
    return { costUSD, costVND };
  }

  public formatCost(costUSD: number, costVND: number): string {
    let usdStr = '';
    if (costUSD === 0) {
      usdStr = '$0.00';
    } else if (costUSD < 0.0001) {
      usdStr = '< $0.0001';
    } else if (costUSD < 0.01) {
      usdStr = `$${costUSD.toFixed(4)}`;
    } else {
      usdStr = `$${costUSD.toFixed(3)}`;
    }
    return `~${usdStr} USD (~${costVND.toLocaleString('vi-VN')} VNĐ)`;
  }

  public formatNumber(num: number): string {
    return num.toLocaleString('en-US');
  }

  public formatTokensCompact(num: number): string {
    if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(2) + 'M';
    }
    if (num >= 1_000) {
      return (num / 1_000).toFixed(1) + 'k';
    }
    return num.toString();
  }

  public getTurnMetrics(): TokenUsageMetrics {
    return { ...this.turnMetrics };
  }

  public getSessionMetrics(): TokenUsageMetrics {
    return { ...this.sessionMetrics };
  }

  private getStatsFilePath(): string {
    const projectPath = settings.get().projectPath;
    return path.join(projectPath, '.devteam', 'token_usage.json');
  }

  public loadProjectStats(): ProjectPersistentStats {
    try {
      const filePath = this.getStatsFilePath();
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
    return {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCalls: 0,
      totalCostUSD: 0,
      lastUpdated: new Date().toISOString(),
    };
  }

  private persistProjectStats(promptTokens: number, completionTokens: number): void {
    try {
      const stats = this.loadProjectStats();
      const cost = this.calculateCost(promptTokens, completionTokens);
      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalTokens += promptTokens + completionTokens;
      stats.totalCalls += 1;
      stats.totalCostUSD += cost.costUSD;
      stats.lastUpdated = new Date().toISOString();

      const dir = path.dirname(this.getStatsFilePath());
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.getStatsFilePath(), JSON.stringify(stats, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  public renderFooter(): string {
    const session = this.sessionMetrics;
    const sessionCost = this.calculateCost(session.promptTokens, session.completionTokens);

    let costStr = '$0.00';
    if (sessionCost.costUSD > 0) {
      if (sessionCost.costUSD < 0.0001) {
        costStr = '<$0.0001';
      } else if (sessionCost.costUSD < 0.01) {
        costStr = `$${sessionCost.costUSD.toFixed(4)}`;
      } else if (sessionCost.costUSD < 1) {
        costStr = `$${sessionCost.costUSD.toFixed(3)}`;
      } else {
        costStr = `$${sessionCost.costUSD.toFixed(2)}`;
      }
    }

    const tokenCount = this.formatNumber(session.totalTokens);
    const plainBadge = `token: ${tokenCount}  estimate: ${costStr}`;
    const styledBadge = `${chalk.dim('token:')} ${chalk.cyan(tokenCount)}  ${chalk.dim('estimate:')} ${chalk.yellow(costStr)}`;

    const width = process.stdout.columns || 80;
    const dashCount = Math.max(5, width - plainBadge.length - 2);
    const leftLine = chalk.dim('─'.repeat(dashCount));

    return `${leftLine} ${styledBadge}`;
  }

  public printFooter(): void {
    console.log(this.renderFooter());
  }

  public printDetailedReport(): void {
    const session = this.sessionMetrics;
    const sessionCost = this.calculateCost(session.promptTokens, session.completionTokens);
    const pricing = this.getPricing();
    const model = settings.get().model;
    const contextUsed = session.totalTokens;
    const contextLimit = pricing.contextWindow;
    const contextPercent = ((contextUsed / contextLimit) * 100).toFixed(2);
    const contextDisplay = `${this.formatTokensCompact(contextUsed)} / ${this.formatTokensCompact(contextLimit)}`;

    console.log(chalk.bold.cyan('\n📊 CHI TIẾT SỬ DỤNG TOKEN & CHI PHÍ:'));
    console.log(
      `  • ${chalk.bold('Token đã dùng:')}  ${chalk.bold.green(this.formatNumber(session.totalTokens))} tokens ` +
        chalk.dim(`(${this.formatNumber(session.promptTokens)} prompt · ${this.formatNumber(session.completionTokens)} completion · ${session.callsCount} lượt gọi)`)
    );
    console.log(
      `  • ${chalk.bold('Chi phí ước tính:')} ${chalk.bold.yellow(this.formatCost(sessionCost.costUSD, sessionCost.costVND))} ` +
        chalk.dim(`[Model: ${model}]`)
    );
    console.log(
      `  • ${chalk.bold('Context Window:')}   ${chalk.green(contextDisplay + ' tokens')} ` +
        chalk.dim(`(${contextPercent}% đã dùng · An toàn)`)
    );
    console.log(this.renderFooter());
  }
}
