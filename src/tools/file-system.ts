import fs from 'fs';
import path from 'path';

export interface FileMatch {
  file: string;
  line: number;
  text: string;
  keyword: string;
}

export class FileSystemTool {
  public static readonly DEFAULT_IGNORES = new Set([
    'node_modules',
    '.git',
    'dist',
    '.devteam',
    '.idea',
    '.vscode',
    'target',
    'build',
    '.gradle',
    'bin',
    'obj',
    '.next',
    '.nuxt',
    '__pycache__',
    '.venv',
    'venv',
    '.claude',
  ]);

  public static readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8');
  }

  public static writeFile(filePath: string, content: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  public static exists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  public static listFiles(dirPath: string): string[] {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath);
  }

  public static findFiles(
    dirPath: string,
    options: {
      extensions?: string[];
      maxDepth?: number;
      maxResults?: number;
      nameFilter?: RegExp | string;
      pathFilter?: RegExp | string;
    } = {}
  ): string[] {
    if (!fs.existsSync(dirPath)) return [];

    const {
      extensions,
      maxDepth = 20,
      maxResults = 250,
      nameFilter,
      pathFilter,
    } = options;

    const results: string[] = [];

    const traverse = (currentDir: string, currentDepth: number) => {
      if (currentDepth > maxDepth || results.length >= maxResults) return;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const name = entry.name;
        if (FileSystemTool.DEFAULT_IGNORES.has(name)) continue;

        const fullPath = path.join(currentDir, name);

        if (entry.isDirectory()) {
          traverse(fullPath, currentDepth + 1);
        } else if (entry.isFile()) {
          if (extensions && extensions.length > 0) {
            const ext = path.extname(name).toLowerCase();
            if (!extensions.includes(ext)) continue;
          }

          if (nameFilter) {
            if (typeof nameFilter === 'string') {
              if (!name.toLowerCase().includes(nameFilter.toLowerCase())) continue;
            } else if (!nameFilter.test(name)) {
              continue;
            }
          }

          if (pathFilter) {
            const rel = path.relative(dirPath, fullPath).toLowerCase();
            if (typeof pathFilter === 'string') {
              if (!rel.includes(pathFilter.toLowerCase())) continue;
            } else if (!pathFilter.test(rel)) {
              continue;
            }
          }

          results.push(fullPath);
        }
      }
    };

    traverse(dirPath, 0);
    return results;
  }

  public static readFileSnippet(filePath: string, maxLines: number = 300, startLine: number = 1): string {
    if (!fs.existsSync(filePath)) return `[Tệp không tồn tại: ${filePath}]`;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, startLine - 1);
      const end = Math.min(lines.length, start + maxLines);

      const snippetLines = lines.slice(start, end).map((line, idx) => {
        const lineNum = (start + idx + 1).toString().padStart(4, ' ');
        return `${lineNum} | ${line}`;
      });

      const totalLines = lines.length;
      const header = `--- ${filePath} (Dòng ${start + 1} - ${end} / Tổng ${totalLines} dòng) ---\n`;
      return header + snippetLines.join('\n');
    } catch (err: any) {
      return `[Lỗi đọc tệp ${filePath}: ${err.message}]`;
    }
  }

  public static searchInFiles(
    dirPath: string,
    keywords: string[],
    options: { extensions?: string[]; maxMatches?: number } = {}
  ): FileMatch[] {
    const { extensions, maxMatches = 50 } = options;
    const matches: FileMatch[] = [];
    const files = FileSystemTool.findFiles(dirPath, { extensions, maxResults: 300, maxDepth: 20 });

    const lowerKeywords = keywords.map((k) => k.toLowerCase());

    for (const file of files) {
      if (matches.length >= maxMatches) break;
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');

        for (let idx = 0; idx < lines.length; idx++) {
          if (matches.length >= maxMatches) break;
          const lineText = lines[idx];
          const lineLower = lineText.toLowerCase();

          for (const kw of lowerKeywords) {
            if (lineLower.includes(kw)) {
              matches.push({
                file: path.relative(dirPath, file),
                line: idx + 1,
                text: lineText.trim(),
                keyword: kw,
              });
              break;
            }
          }
        }
      } catch {
        // ignore unreadable files
      }
    }

    return matches;
  }

  public static getProjectSummary(projectPath: string): string {
    if (!fs.existsSync(projectPath)) return 'Thư mục dự án chưa được khởi tạo.';

    const files = fs.readdirSync(projectPath).filter((f) => !FileSystemTool.DEFAULT_IGNORES.has(f));
    const submodules: string[] = [];

    for (const f of files) {
      const full = path.join(projectPath, f);
      try {
        if (fs.statSync(full).isDirectory()) {
          submodules.push(f);
        }
      } catch {}
    }

    const hasPackageJson = files.includes('package.json');
    const hasPomXml = files.includes('pom.xml');
    const hasCompose =
      files.includes('compose.yaml') ||
      files.includes('docker-compose.yml') ||
      files.includes('docker-compose.infra.yaml');

    let extra = '';
    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
        extra += ` [Node.js: ${pkg.name || 'unnamed'}]`;
      } catch {}
    }
    if (hasPomXml) {
      extra += ' [Maven/Java Multi-module]';
    }
    if (hasCompose) {
      extra += ' [Docker Compose / Microservices]';
    }

    return `Cấu trúc gốc: ${files.slice(0, 25).join(', ')}${extra}\nThư mục/Modules chính: ${submodules.join(', ')}`;
  }
}
