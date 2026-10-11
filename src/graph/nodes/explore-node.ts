import { AgentState } from '../state.js';
import { LLMFactory } from '../../core/llm-factory.js';
import { ClaudeWorker } from '../../terminal/claude-worker.js';
import { FileSystemTool } from '../../tools/file-system.js';
import { Logger } from '../../core/logger.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

function saveExplorationReport(projectPath: string, reportContent: string, intent: string): string {
  const reportsDir = path.join(projectPath, '.devteam', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `EXPLORATION_${timestamp}.md`;
  const reportPath = path.join(reportsDir, filename);
  const latestPath = path.join(reportsDir, 'LATEST_EXPLORATION_REPORT.md');

  const fileContent = `# BÁO CÁO KHẢO SÁT & AUDIT MÃ NGUỒN
- **Thời gian tạo:** ${now.toLocaleString('vi-VN')}
- **Dự án:** ${projectPath}
- **Yêu cầu khảo sát:** ${intent}

---

${reportContent}
`;

  fs.writeFileSync(reportPath, fileContent, 'utf-8');
  fs.writeFileSync(latestPath, fileContent, 'utf-8');

  return latestPath;
}

export async function exploreNode(state: AgentState): Promise<Partial<AgentState>> {
  Logger.agentMessage('Explorer', `Khởi động quy trình khảo sát dự án: ${state.projectPath}...`);

  // Architecture: Master Agent dispatches Claude Code CLI Sub-Agent on a dedicated PTY terminal
  if (ClaudeWorker.isClaudeAvailable()) {
    Logger.agentMessage(
      'Master Agent',
      '🏛️ Điều phối Explorer Sub-Agent (Claude Code CLI) trên terminal PTY ngầm để tự động khảo sát & audit mã nguồn...'
    );

    const prompt = `Bạn là Explorer & Security Auditor Sub-Agent trực thuộc Master Orchestrator (DevTeam).
Nhiệm vụ của bạn: Sử dụng toàn bộ các công cụ của bạn (ripgrep/grep, glob/find, view file, git, bash) để tự động điều tra, đọc hiểu, phân tích sâu và audit toàn diện mã nguồn dự án tại thư mục hiện tại theo yêu cầu sau của người dùng:
"${state.intent}"

HƯỚNG DẪN THỰC HIỆN:
1. Khảo sát cấu trúc thư mục, kiến trúc dự án và các service/module liên quan.
2. Dùng ripgrep (grep) hoặc find để tự động định vị các tệp mã nguồn then chốt liên quan đến yêu cầu (services, sagas, handlers, domain entities, transaction configurations).
3. Đọc trực tiếp các tệp liên quan đến luồng tiền, nghiệp vụ, tính toàn vẹn dữ liệu, concurrency và exception handling.
4. Nếu người dùng yêu cầu Code Review / Tìm bug nghiệp vụ:
   - Kiểm tra kỹ Race Condition, Database Lock (Pessimistic/Optimistic), Distributed Lock.
   - Kiểm tra Idempotency, Double-Execution, Message Retry / Outbox Pattern.
   - Kiểm tra Transaction Boundaries (@Transactional, rollbackFor = Exception.class), nuốt ngoại lệ (swallowed exceptions).
   - Kiểm tra kiểu dữ liệu tiền tệ (BigDecimal vs float/double).
   - Đánh giá Coding Convention & Clean Architecture.
5. Xuất báo cáo chi tiết, chuyên nghiệp, chỉ rõ tên file, vị trí logic, mức độ rủi ro (P0, P1, P2) và code sửa mẫu.

LƯU Ý QUAN TRỌNG:
- Đây là nhiệm vụ KHẢO SÁT & AUDIT. KHÔNG tự ý chỉnh sửa hay ghi đè các tệp mã nguồn của dự án trừ khi được yêu cầu cụ thể.
- Xuất kết quả rõ ràng, mạch lạc để Master Agent tổng hợp và báo cáo cho người dùng.`;

    const worker = new ClaudeWorker({
      role: 'EXPLORER',
      sessionName: 'explorer-worker',
      timeoutMs: 240000, // 4 mins
    });

    const result = await worker.runPrompt(prompt, state.projectPath);

    if (result.success && result.output.trim()) {
      const outputText = result.output.trim();
      const latestPath = saveExplorationReport(state.projectPath, outputText, state.intent);
      const relativePath = path.relative(state.projectPath, latestPath);

      Logger.success('Explorer Sub-Agent (Claude Code CLI) đã hoàn tất khảo sát & lập báo cáo.');
      Logger.info(`📄 Báo cáo đã được lưu trữ tại: ${chalk.bold(relativePath)}`);

      return {
        responseMessage: `${outputText}\n\n---\n📄 **Báo cáo đã được lưu tại:** \`${relativePath}\``,
        isComplete: true,
        currentPhase: 'DONE',
      };
    } else {
      Logger.warn('Explorer Sub-Agent kết thúc không trọn vẹn. Chuyển sang cơ chế khảo sát dự phòng bằng LLM...');
    }
  } else {
    Logger.info('Claude Code CLI chưa được cài đặt. Sử dụng cơ chế khảo sát dự phòng trực tiếp bằng LLM...');
  }

  // Fallback: Direct LLM Exploration & File Discovery
  const summary = FileSystemTool.getProjectSummary(state.projectPath);
  const intentLower = state.intent.toLowerCase();

  const isCodeReview = [
    'review', 'bug', 'lỗi', 'ngoại lệ', 'sai lệch', 'sai', 'logic 2 lần',
    'race condition', 'idempotent', 'idempotency', 'rollback', 'transaction',
    'convention', 'concurrency', 'double spend', 'luồng tiền', 'chuyển tiền',
    'tiền', 'audit', 'bảo mật', 'tài chính', 'khoản', 'soi code', 'đánh giá code'
  ].some((k) => intentLower.includes(k));

  let answer = '';

  if (isCodeReview) {
    const extensions = ['.java', '.ts', '.go', '.py', '.kt', '.sql'];
    const allSourceFiles = FileSystemTool.findFiles(state.projectPath, {
      extensions,
      maxDepth: 20,
      maxResults: 250,
    });

    const domainKeywords = ['transfer', 'account', 'transaction', 'balance', 'saga', 'lock', 'payment', 'money', 'deduct', 'credit', 'outbox'];
    const candidateFiles: string[] = [];

    for (const f of allSourceFiles) {
      const lower = f.toLowerCase();
      if (domainKeywords.some((kw) => lower.includes(kw))) {
        candidateFiles.push(f);
      }
    }

    candidateFiles.sort((a, b) => {
      const score = (file: string) => {
        const base = path.basename(file).toLowerCase();
        if (base.includes('saga')) return 100;
        if (base.includes('handler')) return 90;
        if (base.includes('service')) return 85;
        if (base.includes('aggregate') || base.includes('account.') || base.includes('transfer.')) return 80;
        if (base.includes('repository') || base.includes('adapter')) return 70;
        if (base.includes('controller')) return 60;
        if (base.includes('test')) return 10;
        if (base.includes('dto') || base.includes('event')) return 5;
        return 50;
      };
      return score(b) - score(a);
    });

    const topFiles = candidateFiles.slice(0, 6);
    const searchMatches = FileSystemTool.searchInFiles(
      state.projectPath,
      ['@Transactional', 'Pessimistic', 'Optimistic', 'idempotent', 'BigDecimal', 'Double', 'rollbackFor', 'synchronized'],
      { extensions, maxMatches: 20 }
    );

    let searchSummary = '';
    if (searchMatches.length > 0) {
      searchSummary = searchMatches
        .slice(0, 15)
        .map((m) => `• [${m.file}:${m.line}] (${m.keyword}): ${m.text}`)
        .join('\n');
    }

    const snippets: string[] = [];
    for (const file of topFiles) {
      const snippet = FileSystemTool.readFileSnippet(file, 220, 1);
      snippets.push(snippet);
    }

    const systemPrompt = `Bạn là Senior Principal Banking Solution Architect & Security Auditor chuyên sâu về hệ thống Core Banking, thanh toán và High-Concurrency Microservices.
Nhiệm vụ của bạn là thực hiện Code Review và Bug Audit chuyên sâu dựa trên các tệp mã nguồn và hiện trạng dự án được cung cấp.

Tập trung phân tích kỹ:
1. Concurrency & Race Condition (Pessimistic/Optimistic/Distributed Lock)
2. Idempotency & Double Execution (Message retry, replay, outbox pattern)
3. Transaction Boundaries & Exception Rollbacks (@Transactional rollbackFor, swallowed exceptions)
4. Số học tài chính (BigDecimal vs float/double)
5. Coding Convention & Clean Architecture`;

    const userPrompt = `Dự án: ${state.projectPath}
Yêu cầu người dùng: "${state.intent}"

Hiện trạng cấu trúc dự án:
${summary}

${searchSummary ? `Các điểm xuất hiện từ khóa Transaction/Lock/Precision trong dự án:\n${searchSummary}\n` : ''}

Nội dung mã nguồn các tệp trọng yếu đã được đọc trực tiếp từ ổ đĩa:
${snippets.join('\n\n')}

Hãy tiến hành review và xuất báo cáo chi tiết:`;

    try {
      const model = LLMFactory.createModel();
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);
      if (typeof response.content === 'string' && response.content.trim()) {
        answer = response.content.trim();
      }
    } catch (err: any) {
      answer = `Đã khảo sát ${topFiles.length} tệp mã nguồn nhưng gặp lỗi khi gọi LLM: ${err.message}`;
    }
  } else {
    // General Project Exploration
    let readmeSnippet = '';
    const readmePath = path.join(state.projectPath, 'README.md');
    if (fs.existsSync(readmePath)) {
      try {
        readmeSnippet = fs.readFileSync(readmePath, 'utf-8').slice(0, 2000);
      } catch {}
    }

    const systemPrompt = `Bạn là một Lead Solution Architect chuyên đánh giá và phân tích mã nguồn trong môi trường Terminal CLI.
Nhiệm vụ của bạn là giải đáp câu hỏi của người dùng về dự án hiện tại, giải thích cấu trúc thư mục, công nghệ sử dụng, và mục đích của dự án một cách rõ ràng, trực quan, chuyên nghiệp.`;

    const userPrompt = `Dự án: ${state.projectPath}
Câu hỏi của người dùng: "${state.intent}"

Cấu trúc tệp tin hiện tại:
${summary}

${readmeSnippet ? `README.md:\n${readmeSnippet}\n` : ''}

Hãy đưa ra câu trả lời chi tiết và hữu ích cho người dùng.`;

    try {
      const model = LLMFactory.createModel();
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);
      if (typeof response.content === 'string' && response.content.trim()) {
        answer = response.content.trim();
      }
    } catch (err: any) {
      answer = 'Dự án hiện tại:\n' + summary;
    }
  }

  const latestPath = saveExplorationReport(state.projectPath, answer, state.intent);
  const relativePath = path.relative(state.projectPath, latestPath);

  Logger.agentMessage('Explorer', answer);
  Logger.info(`📄 Báo cáo đã được lưu trữ tại: ${chalk.bold(relativePath)}`);

  return {
    responseMessage: `${answer}\n\n---\n📄 **Báo cáo đã được lưu tại:** \`${relativePath}\``,
    isComplete: true,
    currentPhase: 'DONE',
  };
}
