import fs from 'fs';
import path from 'path';

export class FileSystemTool {
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

  public static getProjectSummary(projectPath: string): string {
    if (!fs.existsSync(projectPath)) return 'Thư mục dự án chưa được khởi tạo.';

    const files = fs.readdirSync(projectPath).filter((f) => !f.startsWith('.git') && f !== 'node_modules');
    const hasPackageJson = files.includes('package.json');
    let pkgDetails = '';
    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8'));
        pkgDetails = ` (name: ${pkg.name || 'unnamed'}, dependencies: ${Object.keys(pkg.dependencies || {}).join(', ') || 'none'})`;
      } catch {
        // ignore
      }
    }

    return `Tệp tin trong dự án: ${files.slice(0, 15).join(', ')}${files.length > 15 ? '...' : ''}${pkgDetails}`;
  }
}
