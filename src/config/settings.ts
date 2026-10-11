import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Load initial .env if present
dotenv.config();

export interface DevTeamConfigFile {
  provider: string;
  model: string;
  apiKey: string;
}

export interface DevTeamConfig {
  provider: string;
  providerUrl: string;
  apiKey: string;
  model: string;
  projectPath: string;
  maxRetries: number;
  autoConfirm: boolean;
  configFilePath: string;
}

export interface ModelOption {
  name: string;
  upstream: string;
  context: string;
  output: string;
  isDefault?: boolean;
}

export const SUPPORTED_MODELS: ModelOption[] = [
  {
    name: 'gemini',
    upstream: 'ag/gemini-pro-agent',
    context: '1.0M',
    output: '64k',
    isDefault: true,
  },
  {
    name: 'claude-sonnet',
    upstream: 'ag/claude-sonnet-4-6',
    context: '1M',
    output: '128k',
  },
];

const DEFAULT_PROVIDER_URLS: Record<string, string> = {
  '9router': 'https://9router.com/v1',
  'openrouter': 'https://openrouter.ai/api/v1',
  'anthropic': 'https://api.anthropic.com/v1',
  'openai': 'https://api.openai.com/v1',
};

class SettingsManager {
  private config: DevTeamConfig;
  private activeConfigPath: string;

  constructor() {
    const cwdConfig = path.join(process.cwd(), 'config.json');
    const homeConfigDir = path.join(os.homedir(), '.devteam');
    const homeConfig = path.join(homeConfigDir, 'config.json');

    // Prefer local ./config.json if exists, else ~/.devteam/config.json, else create ./config.json
    if (fs.existsSync(cwdConfig)) {
      this.activeConfigPath = cwdConfig;
    } else if (fs.existsSync(homeConfig)) {
      this.activeConfigPath = homeConfig;
    } else {
      this.activeConfigPath = cwdConfig;
    }

    const saved = this.loadConfigFile(this.activeConfigPath);

    const provider = saved.provider || process.env.LLM_PROVIDER || '9router';
    const providerUrl =
      process.env.LLM_PROVIDER_URL ||
      DEFAULT_PROVIDER_URLS[provider.toLowerCase()] ||
      'https://9router.com/v1';

    const apiKey =
      saved.apiKey ||
      process.env.LLM_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '';

    // Default model is gemini (9router)
    const model = saved.model || process.env.LLM_MODEL || 'gemini';

    const projectPath =
      process.env.TARGET_PROJECT_DIR ||
      process.cwd();

    this.config = {
      provider,
      providerUrl,
      apiKey,
      model,
      projectPath: this.resolveProjectPath(projectPath),
      maxRetries: parseInt(process.env.MAX_SELF_HEALING_RETRIES || '3', 10),
      autoConfirm: process.env.AUTO_CONFIRM === 'true',
      configFilePath: this.activeConfigPath,
    };

    // If config file did not exist, write initial template with only provider, model, apiKey
    if (!fs.existsSync(this.activeConfigPath)) {
      this.saveConfig();
    }

    // Synchronize environment variables for sub-processes and Claude CLI
    this.syncEnvironment();
  }

  private loadConfigFile(filePath: string): Partial<DevTeamConfigFile> {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          provider: parsed.provider,
          model: parsed.model,
          // Support apiKey, aplkey, or api_key
          apiKey: parsed.apiKey || parsed.aplkey || parsed.api_key || '',
        };
      }
    } catch {
      // ignore
    }
    return {};
  }

  public saveConfig(): void {
    try {
      // Config file contains ONLY provider, model and apiKey as requested
      const fileContent: DevTeamConfigFile = {
        provider: this.config.provider,
        model: this.config.model,
        apiKey: this.config.apiKey,
      };
      fs.writeFileSync(this.activeConfigPath, JSON.stringify(fileContent, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  private syncEnvironment(): void {
    process.env.LLM_PROVIDER = this.config.provider;
    process.env.LLM_PROVIDER_URL = this.config.providerUrl;
    process.env.LLM_MODEL = this.config.model;
    process.env.LLM_API_KEY = this.config.apiKey;
    process.env.ANTHROPIC_BASE_URL = this.config.providerUrl;
    process.env.ANTHROPIC_API_KEY = this.config.apiKey;
    process.env.OPENAI_API_BASE = this.config.providerUrl;
    process.env.OPENAI_API_KEY = this.config.apiKey;
  }

  public get(): DevTeamConfig {
    return { ...this.config };
  }

  public setProvider(providerName: string, customUrl?: string): void {
    const key = providerName.trim().toLowerCase();
    this.config.provider = key;
    if (customUrl) {
      this.config.providerUrl = customUrl;
    } else if (DEFAULT_PROVIDER_URLS[key]) {
      this.config.providerUrl = DEFAULT_PROVIDER_URLS[key];
    } else if (key.startsWith('http://') || key.startsWith('https://')) {
      this.config.providerUrl = providerName;
      this.config.provider = 'custom';
    }
    this.syncEnvironment();
    this.saveConfig();
  }

  public setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey.trim();
    this.syncEnvironment();
    this.saveConfig();
  }

  public setModel(model: string): void {
    this.config.model = model.trim();
    this.syncEnvironment();
    this.saveConfig();
  }

  public setProjectPath(rawPath: string): string {
    const resolved = this.resolveProjectPath(rawPath);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    this.config.projectPath = resolved;
    process.env.TARGET_PROJECT_DIR = resolved;
    return resolved;
  }

  public resolveProjectPath(inputPath: string): string {
    const trimmed = inputPath.trim();
    const homeDir = os.homedir();
    const currentUsername = os.userInfo().username;

    let target = trimmed;

    // Handle paths starting with ~
    if (target.startsWith('~')) {
      target = path.join(homeDir, target.slice(1));
    }
    // Handle paths starting with username shorthand e.g. "hieukq/desktop/..."
    else if (
      target.toLowerCase().startsWith('hieukq/') ||
      target.toLowerCase().startsWith('hieukq\\') ||
      target.toLowerCase() === 'hieukq'
    ) {
      let rest = target.slice('hieukq'.length).replace(/^[/\\]+/, '');
      if (rest.toLowerCase().startsWith('desktop/') || rest.toLowerCase() === 'desktop') {
        const desktopSub = rest.slice('desktop'.length);
        rest = 'Desktop' + desktopSub;
      }
      target = path.join(homeDir, rest);
    } else if (
      target.toLowerCase().startsWith(currentUsername.toLowerCase() + '/') ||
      target.toLowerCase().startsWith(currentUsername.toLowerCase() + '\\')
    ) {
      let rest = target.slice(currentUsername.length).replace(/^[/\\]+/, '');
      if (rest.toLowerCase().startsWith('desktop/') || rest.toLowerCase() === 'desktop') {
        const desktopSub = rest.slice('desktop'.length);
        rest = 'Desktop' + desktopSub;
      }
      target = path.join(homeDir, rest);
    }

    // If still relative, resolve against cwd
    if (!path.isAbsolute(target)) {
      target = path.resolve(process.cwd(), target);
    }

    return path.normalize(target);
  }
}

export const settings = new SettingsManager();
