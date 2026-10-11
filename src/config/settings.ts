import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Load initial .env from current directory or home directory
dotenv.config();

export interface DevTeamConfig {
  provider: string;
  providerUrl: string;
  apiKey: string;
  model: string;
  projectPath: string;
  maxRetries: number;
  autoConfirm: boolean;
}

const DEFAULT_PROVIDER_URLS: Record<string, string> = {
  '9router': 'https://9router.com/v1',
  'openrouter': 'https://openrouter.ai/api/v1',
  'anthropic': 'https://api.anthropic.com/v1',
  'openai': 'https://api.openai.com/v1',
};

class SettingsManager {
  private config: DevTeamConfig;
  private configFilePath: string;

  constructor() {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.devteam');
    if (!fs.existsSync(configDir)) {
      try {
        fs.mkdirSync(configDir, { recursive: true });
      } catch {
        // ignore
      }
    }
    this.configFilePath = path.join(configDir, 'config.json');

    // Load saved settings if any
    const saved = this.loadSavedConfig();

    const provider = saved.provider || process.env.LLM_PROVIDER || '9router';
    const providerUrl =
      saved.providerUrl ||
      process.env.LLM_PROVIDER_URL ||
      DEFAULT_PROVIDER_URLS[provider.toLowerCase()] ||
      'https://9router.com/v1';
    const apiKey =
      saved.apiKey ||
      process.env.LLM_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '';
    const model =
      saved.model ||
      process.env.LLM_MODEL ||
      'claude-3-5-sonnet';
    const projectPath =
      saved.projectPath ||
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
    };
  }

  private loadSavedConfig(): Partial<DevTeamConfig> {
    try {
      if (fs.existsSync(this.configFilePath)) {
        const raw = fs.readFileSync(this.configFilePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
    return {};
  }

  public saveConfig(): void {
    try {
      fs.writeFileSync(this.configFilePath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch {
      // ignore
    }
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
    // Update process.env for Claude CLI & sub-processes
    process.env.LLM_PROVIDER = this.config.provider;
    process.env.LLM_PROVIDER_URL = this.config.providerUrl;
    process.env.ANTHROPIC_BASE_URL = this.config.providerUrl;
    this.saveConfig();
  }

  public setApiKey(apiKey: string): void {
    this.config.apiKey = apiKey.trim();
    process.env.LLM_API_KEY = this.config.apiKey;
    process.env.ANTHROPIC_API_KEY = this.config.apiKey;
    process.env.OPENAI_API_KEY = this.config.apiKey;
    this.saveConfig();
  }

  public setModel(model: string): void {
    this.config.model = model.trim();
    process.env.LLM_MODEL = this.config.model;
    this.saveConfig();
  }

  public setProjectPath(rawPath: string): string {
    const resolved = this.resolveProjectPath(rawPath);
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    this.config.projectPath = resolved;
    process.env.TARGET_PROJECT_DIR = resolved;
    this.saveConfig();
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
