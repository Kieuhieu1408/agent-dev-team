export interface BugReport {
  summary: string;
  failedFile?: string;
  lineNumber?: string;
  extractedError: string;
  rawLog: string;
}

export class LogParser {
  private static ERROR_KEYWORDS = [
    /AssertionError/i,
    /Error:\s*(.*)/i,
    /FAIL(?:ED)?(?:\s*:\s*(.*))?/i,
    /BUILD FAILURE/i,
    /SyntaxError:\s*(.*)/i,
    /TypeError:\s*(.*)/i,
    /ReferenceError:\s*(.*)/i,
    /Test Suites:\s*.*failed/i,
    /Tests:\s*.*failed/i,
  ];

  public static parse(log: string, exitCode: number): BugReport | null {
    if (exitCode === 0 && !this.containsFailures(log)) {
      return null;
    }

    const lines = log.split(/\r?\n/);
    const relevantLines: string[] = [];
    let failedFile: string | undefined;
    let lineNumber: string | undefined;
    let summary = 'Kiểm thử thất bại với exit code khác 0.';

    // Look for file path and line number patterns
    // e.g. at ... (/path/to/file.ts:12:34) or file.ts:12
    const fileLineRegex = /(?:at\s+.*?\()?([a-zA-Z0-9_\-\.\/]+\.(?:ts|js|py|java|go|rs)):(\d+)(?::(\d+))?\)?/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for file and line
      if (!failedFile) {
        const fileMatch = line.match(fileLineRegex);
        if (fileMatch && !line.includes('node_modules')) {
          failedFile = fileMatch[1];
          lineNumber = fileMatch[2];
        }
      }

      // Check for error keywords
      for (const regex of this.ERROR_KEYWORDS) {
        if (regex.test(line)) {
          summary = line.trim();
          // Extract a window of context (5 lines before to 15 lines after)
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 15);
          for (let j = start; j < end; j++) {
            if (!relevantLines.includes(lines[j])) {
              relevantLines.push(lines[j]);
            }
          }
          break;
        }
      }
    }

    // If no specific lines were extracted, take the last 20 lines
    const extractedError =
      relevantLines.length > 0
        ? relevantLines.join('\n')
        : lines.slice(-25).join('\n');

    return {
      summary,
      failedFile,
      lineNumber,
      extractedError: extractedError.trim(),
      rawLog: log,
    };
  }

  private static containsFailures(log: string): boolean {
    return this.ERROR_KEYWORDS.some((regex) => regex.test(log));
  }
}
