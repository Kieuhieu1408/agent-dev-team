export interface GuardrailResult {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

export class Guardrails {
  private static DANGEROUS_PATTERNS: RegExp[] = [
    /\brm\s+(-[rfRF]+\s+)?(\/|~|\$HOME|\.\.)\s*$/,
    /\brm\s+-[rfRF]*\s+\/\s*/,
    /\bmkfs\b/,
    /\bdd\s+if=.*of=\/dev\//,
    /\bchmod\s+(-R\s+)?777\s+\//,
    /\bchown\s+(-R\s+)?root\s+\//,
    />\s*\/etc\//,
    />\s*\/dev\//,
    /\bshutdown\b/,
    /\breboot\b/,
    /\binit\s+0\b/,
    /\bkillall\s+-9\s+(systemd|launchd)/,
  ];

  private static SUSPICIOUS_PATTERNS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\bgit\s+reset\s+--hard\b/, reason: 'Phục hồi git phá hủy các thay đổi chưa commit' },
    { pattern: /\bgit\s+clean\s+-[fFdD]+/, reason: 'Xóa toàn bộ các untracked file' },
    { pattern: /\bgit\s+push\s+.*--force\b/, reason: 'Ghi đè lịch sử git trên remote repo' },
    { pattern: /\bdrop\s+database\b/i, reason: 'Lệnh xóa cơ sở dữ liệu' },
    { pattern: /\brm\s+-[rfRF]+/, reason: 'Lệnh xóa thư mục đệ quy' },
  ];

  public static check(command: string): GuardrailResult {
    const trimmed = command.trim();

    // Check strictly forbidden commands
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: false,
          requiresConfirmation: false,
          reason: `Lệnh nguy hiểm bị cấm hoàn toàn bởi Guardrail: "${trimmed}"`,
        };
      }
    }

    // Check commands that require human confirmation
    for (const { pattern, reason } of this.SUSPICIOUS_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          allowed: true,
          requiresConfirmation: true,
          reason: `Cảnh báo an toàn (${reason}): "${trimmed}"`,
        };
      }
    }

    return {
      allowed: true,
      requiresConfirmation: false,
    };
  }
}
