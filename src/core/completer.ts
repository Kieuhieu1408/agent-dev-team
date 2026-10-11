import path from 'path';
import os from 'os';
import fs from 'fs';
import { settings, SUPPORTED_MODELS } from '../config/settings.js';

export class HistoryManager {
  private static instance: HistoryManager;
  private historyFile: string;
  private words: Set<string>;

  private constructor() {
    const dir = path.join(os.homedir(), '.devteam');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}
    }
    this.historyFile = path.join(dir, 'history_words.json');
    this.words = new Set<string>();
    this.load();
    this.seed();
  }

  public static getInstance(): HistoryManager {
    if (!this.instance) {
      this.instance = new HistoryManager();
    }
    return this.instance;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const w of list) {
            if (typeof w === 'string' && w.trim()) {
              this.words.add(w.trim());
            }
          }
        }
      }
    } catch {}
  }

  public save(): void {
    try {
      fs.writeFileSync(
        this.historyFile,
        JSON.stringify(Array.from(this.words), null, 2),
        'utf-8'
      );
    } catch {}
  }

  private seed(): void {
    // Seed with current project
    try {
      const cur = settings.get().projectPath;
      if (cur) {
        this.addWord(path.basename(cur));
        this.addWord(cur);
      }
    } catch {}

    // Seed with common directories on Desktop
    try {
      const desktop = path.join(os.homedir(), 'Desktop');
      if (fs.existsSync(desktop)) {
        const entries = fs.readdirSync(desktop, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && !e.name.startsWith('.')) {
            this.addWord(e.name);
            this.addWord(`Desktop/${e.name}`);
            this.addWord(`desktop/${e.name}`);
          }
        }
      }
    } catch {}
  }

  public addWord(word: string): void {
    const trimmed = word.trim();
    if (trimmed.length >= 2 && !/^\d+$/.test(trimmed)) {
      this.words.add(trimmed);
      this.save();
    }
  }

  public addLine(line: string): void {
    const tokens = line.trim().split(/[\s,;]+/);
    for (const t of tokens) {
      const clean = t.replace(/^['"/]+|['"/]+$/g, '');
      if (clean && clean.length >= 2) {
        this.addWord(clean);
      }
    }
  }

  public getWords(): string[] {
    return Array.from(this.words);
  }
}

export const historyManager = HistoryManager.getInstance();

export function getProjectCandidates(): string[] {
  const candidates = new Set<string>();

  // 1. All previously entered project names / words
  for (const w of historyManager.getWords()) {
    candidates.add(w);
  }

  // 2. Desktop directories
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    if (fs.existsSync(desktop)) {
      const entries = fs.readdirSync(desktop, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          candidates.add(e.name);
          candidates.add(`Desktop/${e.name}`);
          candidates.add(`desktop/${e.name}`);
        }
      }
    }
  } catch {}

  // 3. Workspace subdirectories
  try {
    const ws = path.join(os.homedir(), 'Desktop', 'workspace');
    if (fs.existsSync(ws)) {
      const entries = fs.readdirSync(ws, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          candidates.add(e.name);
          candidates.add(`workspace/${e.name}`);
        }
      }
    }
  } catch {}

  // 4. Current project directory subfolders
  try {
    const cur = settings.get().projectPath;
    if (fs.existsSync(cur)) {
      candidates.add(path.basename(cur));
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          candidates.add(e.name);
        }
      }
    }
  } catch {}

  // 5. User home non-hidden folders
  try {
    const home = os.homedir();
    const entries = fs.readdirSync(home, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        candidates.add(e.name);
      }
    }
  } catch {}

  return Array.from(candidates);
}

export function cliCompleter(line: string): [string[], string] {
  const lastSpace = line.lastIndexOf(' ');
  const prefix = lastSpace >= 0 ? line.slice(0, lastSpace + 1) : '';
  const lastToken = lastSpace >= 0 ? line.slice(lastSpace + 1) : line;

  // 1. Slash commands completion at line start
  if (line.startsWith('/') && !line.includes(' ')) {
    const slashCommands = [
      '/provider',
      '/api-key',
      '/project',
      '/model',
      '/status',
      '/tasks',
      '/logs',
      '/autoconfirm',
      '/help',
      '/stop',
      '/clear',
      '/exit',
      '/quit',
    ];
    const hits = slashCommands.filter((c) =>
      c.toLowerCase().startsWith(line.toLowerCase())
    );
    return [hits.length > 0 ? hits : slashCommands, line];
  }

  // 2. Model completion: /model <tab> or model <tab>
  if (/^(\/)?model\s+/i.test(line)) {
    const models = SUPPORTED_MODELS.map((m) => m.name);
    const hits = models
      .filter((m) => m.toLowerCase().startsWith(lastToken.toLowerCase()))
      .map((m) => prefix + m);
    return [hits.length > 0 ? hits : models.map((m) => prefix + m), line];
  }

  // 3. Provider completion: /provider <tab> or provider <tab>
  if (/^(\/)?provider\s+/i.test(line)) {
    const providers = ['9router', 'openrouter', 'anthropic', 'openai'];
    const hits = providers
      .filter((p) => p.toLowerCase().startsWith(lastToken.toLowerCase()))
      .map((p) => prefix + p);
    return [hits.length > 0 ? hits : providers.map((p) => prefix + p), line];
  }

  // 4. Project & navigation completion: cd <tab>, /project <tab>, project <tab>
  if (/^(cd|(\/)?project)\s+/i.test(line)) {
    const candidates = getProjectCandidates();
    const hits = candidates
      .filter((c) => c.toLowerCase().startsWith(lastToken.toLowerCase()))
      .map((c) => prefix + c);
    return [hits, line];
  }

  // 5. File/Folder completion in current project directory for commands like cat, ls, rm, etc.
  if (/^(cat|ls|rm|node|python|python3)\s+/i.test(line)) {
    try {
      const cur = settings.get().projectPath;
      const files = fs.readdirSync(cur).filter((f) => !f.startsWith('.'));
      const hits = files
        .filter((f) => f.toLowerCase().startsWith(lastToken.toLowerCase()))
        .map((f) => prefix + f);
      if (hits.length > 0) {
        return [hits, line];
      }
    } catch {}
  }

  // 6. Standalone project name or general word completion
  if (lastToken) {
    const candidates = getProjectCandidates();
    const hits = candidates
      .filter((c) => c.toLowerCase().startsWith(lastToken.toLowerCase()))
      .map((c) => prefix + c);
    if (hits.length > 0) {
      return [hits, line];
    }
  }

  return [[], line];
}
