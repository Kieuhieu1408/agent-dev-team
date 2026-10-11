import { AgentState } from '../state.js';
import { LLMFactory } from '../../core/llm-factory.js';
import { Logger } from '../../core/logger.js';
import { HumanMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';

export async function supervisorNode(state: AgentState): Promise<Partial<AgentState>> {
  Logger.agentMessage('Supervisor', `Đánh giá ý định người dùng: "${state.intent}"`);

  const trimmed = state.intent.trim().toLowerCase();
  const messages: BaseMessage[] = state.messages || [];

  // Helper to extract past context
  const getPreviousUserIntent = (): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m._getType() === 'human') {
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        if (text.trim().toLowerCase() !== trimmed && text.length > 5) {
          return text;
        }
      }
    }
    return null;
  };

  const getPreviousAIMessage = (): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m._getType() === 'ai') {
        return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      }
    }
    return null;
  };

  // 1. Contextual Affirmation / Granting Permission check
  const affirmativeKeywords = [
    'tôi đồng ý', 'đồng ý', 'ok', 'oke', 'okie', 'yes', 'yep', 'ừ', 'được',
    'tiến hành đi', 'làm đi', 'triển khai đi', 'toàn quyền', 'cho phép', 'duyệt',
    'cho bạn toàn quyền', 'tôi cho bạn toàn quyền thực hiện hành động',
    'tôi cho bạn toàn quyền truy cập tất cả các file', 'thực hiện đi', 'chạy đi',
    'đồng ý nhé', 'cứ làm đi'
  ];

  const isAffirmative = affirmativeKeywords.some(
    (k) => trimmed === k || trimmed.startsWith(k + ' ') || trimmed.endsWith(' ' + k)
  );

  if (isAffirmative && messages.length > 0) {
    const prevAI = getPreviousAIMessage() || '';
    const prevUser = getPreviousUserIntent() || '';
    const combinedContext = (prevAI + ' ' + prevUser).toLowerCase();

    // Check if the previous context was exploration, review, or code analysis
    const isExploreContext =
      combinedContext.includes('review') ||
      combinedContext.includes('khảo sát') ||
      combinedContext.includes('tìm hiểu') ||
      combinedContext.includes('bug nghiệp vụ') ||
      combinedContext.includes('sai lệch tiền') ||
      combinedContext.includes('service') ||
      combinedContext.includes('corebank');

    if (isExploreContext) {
      Logger.info('Ý định phân loại: [EXPLORE] Người dùng đồng ý/tiếp nối yêu cầu review & khảo sát mã nguồn.');
      return {
        intent: prevUser || state.intent,
        requestType: 'EXPLORE',
        currentPhase: 'IDLE',
      };
    } else {
      Logger.info('Ý định phân loại: [DEV] Người dùng đồng ý/xác nhận tiếp tục tiến trình phát triển.');
      return {
        intent: prevUser || state.intent,
        requestType: 'DEV',
        currentPhase: 'PLANNING',
      };
    }
  }

  // 2. Fast-path pattern checks for obvious chat greetings & casual phrases
  const chatKeywords = [
    'hello', 'hi', 'hey', 'xin chào', 'chào bạn', 'chào',
    'bạn là ai', 'who are you', 'cảm ơn', 'thank', 'thanks',
    'ủa tôi đâu có bảo làm việc', 'chỉ chat thôi', 'chém gió'
  ];
  if (chatKeywords.some((k) => trimmed === k || trimmed.startsWith(k + ' ') || trimmed.endsWith(' ' + k))) {
    Logger.info('Ý định phân loại: [CHAT] Trò chuyện thông thường.');
    return {
      requestType: 'CHAT',
      currentPhase: 'IDLE',
    };
  }

  // 3. Fast-path pattern checks for project exploration & code review
  const exploreKeywords = [
    'dự án này là gì', 'dự án này làm gì', 'giải thích dự án',
    'tìm hiểu dự án', 'cấu trúc dự án', 'cấu trúc folder', 'cấu trúc thư mục',
    'tech stack là gì', 'project này có gì', 'hướng dẫn dự án', 'readme',
    'review code', 'review coding', 'review dự án', 'đánh giá code',
    'tìm bug nghiệp vụ', 'sai lệch tiền', 'logic 2 lần', 'race condition',
    'idempotency', 'kiểm tra ngoại lệ', 'code convention'
  ];
  if (exploreKeywords.some((k) => trimmed.includes(k))) {
    Logger.info('Ý định phân loại: [EXPLORE] Khám phá, review mã nguồn & tìm bug nghiệp vụ.');
    return {
      requestType: 'EXPLORE',
      currentPhase: 'IDLE',
    };
  }

  // 4. Fast-path pattern checks for vague/ambiguous inputs (Only when no prior context)
  const clarifyKeywords = [
    'chưa rõ', 'không rõ', 'làm gì', 'thế nào', 'sao', 'sao thế',
    'gì vậy', 'là sao', 'alo', 'ê', 'ơi'
  ];
  if (clarifyKeywords.some((k) => trimmed === k) && messages.length <= 1) {
    Logger.info('Ý định phân loại: [CLARIFY] Ý định chưa rõ ràng.');
    return {
      requestType: 'CLARIFY',
      responseMessage: 'Tôi chưa rõ đây là gì, bạn hãy nói rõ ý định của mình. (Ví dụ: Bạn muốn trò chuyện, tìm hiểu dự án hiện tại, hay phát triển tính năng gì?)',
      currentPhase: 'IDLE',
    };
  }

  // Format recent conversation context for LLM classifier
  let historyContext = '';
  if (messages.length > 0) {
    const recent = messages.slice(-5);
    historyContext = recent
      .map((m) => {
        const role = m._getType() === 'human' ? 'Người dùng' : 'AI';
        const txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${role}: ${txt.slice(0, 600)}`;
      })
      .join('\n');
  }

  const systemPrompt = `Bạn là một AI Supervisor / Intent Classifier cấp cao trong hệ thống Multi-Agent DevTeam.
Nhiệm vụ của bạn là phân loại chính xác ý định (Intent) của người dùng vào 1 trong 4 nhóm:

1. "CHAT": Trò chuyện xã giao, chào hỏi, chia sẻ, đặt câu hỏi chung chung, hoặc hỏi đáp tiếp nối về báo cáo/tiến độ/trạng thái dự án ("hello", "báo cáo ở đâu", "báo cáo bạn vừa làm", "tôi chỉ chat thôi", "bạn làm được gì").
2. "EXPLORE": Người dùng muốn tìm hiểu, giải thích, khám phá kiến trúc, đọc hiểu mã nguồn, review code, audit bảo mật, tìm bug nghiệp vụ, kiểm tra coding convention mà KHÔNG yêu cầu sửa đổi code. Hệ thống sẽ tự động quét và đọc mã nguồn để trả lời.
3. "DEV": Người dùng muốn phát triển tính năng mới, sửa lỗi, viết mã nguồn, tạo test, refactor, hoặc can thiệp kỹ thuật trực tiếp vào file ("viết hàm", "thêm login", "fix bug null pointer", "tạo file").
4. "CLARIFY": Người dùng nhập câu nói hoàn toàn cụt lủn, mơ hồ, tối nghĩa khi KHÔNG có ngữ cảnh hội thoại nào trước đó.

QUY TẮC ĐẶC BIỆT KHI CÓ NGỮ CẢNH HỘI THOẠI:
- Nếu có lịch sử hội thoại trước đó và người dùng nói những câu như "tôi đồng ý", "cho bạn toàn quyền", "làm đi", "tiến hành đi", "ok", "tiếp tục": DỰA VÀO HÀNH ĐỘNG TRƯỚC ĐÓ để phân loại vào EXPLORE hoặc DEV. TUYỆT ĐỐI KHÔNG phân loại thành CLARIFY khi người dùng đang tiếp nối cuộc đối thoại.
- Nếu người dùng hỏi về báo cáo vừa làm, vị trí lưu báo cáo ("báo cáo ở đâu", "file báo cáo", "báo cáo bạn vừa hoàn thành đó"), phân loại là CHAT để trợ lý đàm thoại và chỉ rõ vị trí file hoặc giải đáp kết quả.
- Nếu người dùng yêu cầu review code hoặc tìm bug trong mã nguồn mà không bảo sửa code, LUÔN LUÔN phân loại là EXPLORE.

Hãy trả về DUY NHẤT một chuỗi JSON theo định dạng:
{"type": "CHAT" | "EXPLORE" | "DEV" | "CLARIFY", "reason": "Lý do ngắn gọn dưới 20 từ", "clarificationMessage": "Nếu type là CLARIFY, hãy viết câu ngắn hỏi rõ ý định"}`;

  const userPrompt = `Dự án: ${state.projectPath}
${historyContext ? `Ngữ cảnh hội thoại trước đó:\n${historyContext}\n` : ''}
Nội dung người dùng vừa nhập: "${state.intent}"

Phân loại:`;

  try {
    const model = LLMFactory.createModel();
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const type = (parsed.type || '').toUpperCase();
      if (type === 'CLARIFY') {
        const msg = parsed.clarificationMessage || 'Tôi chưa rõ đây là gì, bạn hãy nói rõ ý định của mình. (Ví dụ: Bạn muốn trò chuyện, tìm hiểu dự án hiện tại, hay phát triển tính năng gì?)';
        Logger.info(`Ý định được AI xác định: [CLARIFY] - ${parsed.reason || ''}`);
        return {
          requestType: 'CLARIFY',
          responseMessage: msg,
          currentPhase: 'IDLE',
        };
      }
      if (type === 'CHAT' || type === 'EXPLORE' || type === 'DEV') {
        Logger.info(`Ý định được AI xác định: [${type}] - ${parsed.reason || ''}`);
        return {
          requestType: type as any,
          currentPhase: type === 'DEV' ? 'PLANNING' : 'IDLE',
        };
      }
    }
  } catch (err: any) {
    Logger.warn(`Supervisor phân loại dự phòng: ${err.message}`);
  }

  // Fallback: If input is too short and has NO context, ask to clarify
  const devActionVerbs = ['tạo', 'viết', 'thêm', 'sửa', 'fix', 'xây dựng', 'refactor', 'build', 'add', 'create', 'update', 'delete', 'hàm', 'chức năng', 'tính năng'];
  const hasDevVerb = devActionVerbs.some((v) => trimmed.includes(v));

  if (!hasDevVerb && trimmed.split(/\s+/).length <= 3 && messages.length <= 1) {
    Logger.info('Ý định mặc định: [CLARIFY] Yêu cầu ngắn/chưa rõ hành động.');
    return {
      requestType: 'CLARIFY',
      responseMessage: 'Tôi chưa rõ đây là gì, bạn hãy nói rõ ý định của mình. (Ví dụ: Bạn muốn trò chuyện, tìm hiểu dự án hiện tại, hay phát triển tính năng gì?)',
      currentPhase: 'IDLE',
    };
  }

  // Fallback to DEV
  Logger.info('Ý định mặc định: [DEV] Phát triển tính năng.');
  return {
    requestType: 'DEV',
    currentPhase: 'PLANNING',
  };
}
