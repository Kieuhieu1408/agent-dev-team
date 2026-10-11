import { AgentState } from '../state.js';
import { LLMFactory } from '../../core/llm-factory.js';
import { Logger } from '../../core/logger.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export async function supervisorNode(state: AgentState): Promise<Partial<AgentState>> {
  Logger.agentMessage('Supervisor', `Đánh giá ý định người dùng: "${state.intent}"`);

  const trimmed = state.intent.trim().toLowerCase();

  // Fast-path pattern checks for obvious chat greetings & casual phrases
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

  // Fast-path pattern checks for project exploration
  const exploreKeywords = [
    'dự án này là gì', 'dự án này làm gì', 'giải thích dự án',
    'tìm hiểu dự án', 'cấu trúc dự án', 'cấu trúc folder', 'cấu trúc thư mục',
    'tech stack là gì', 'project này có gì', 'hướng dẫn dự án', 'readme'
  ];
  if (exploreKeywords.some((k) => trimmed.includes(k))) {
    Logger.info('Ý định phân loại: [EXPLORE] Khám phá & tìm hiểu dự án.');
    return {
      requestType: 'EXPLORE',
      currentPhase: 'IDLE',
    };
  }

  // Fast-path pattern checks for vague/ambiguous inputs
  const clarifyKeywords = [
    'chưa rõ', 'không rõ', 'làm gì', 'thế nào', 'sao', 'sao thế',
    'gì vậy', 'là sao', 'alo', 'ê', 'ơi'
  ];
  if (clarifyKeywords.some((k) => trimmed === k)) {
    Logger.info('Ý định phân loại: [CLARIFY] Ý định chưa rõ ràng.');
    return {
      requestType: 'CLARIFY',
      responseMessage: 'Tôi chưa rõ đây là gì, bạn hãy nói rõ ý định của mình. (Ví dụ: Bạn muốn trò chuyện, tìm hiểu dự án hiện tại, hay phát triển tính năng gì?)',
      currentPhase: 'IDLE',
    };
  }

  const systemPrompt = `Bạn là một AI Supervisor / Intent Classifier cấp cao trong hệ thống Multi-Agent DevTeam.
Nhiệm vụ của bạn là phân loại chính xác ý định (Intent) của người dùng vào 1 trong 4 nhóm:

1. "CHAT": Trò chuyện xã giao, chào hỏi, chia sẻ, đặt câu hỏi chung chung không yêu cầu sửa đổi code, không yêu cầu viết tính năng mới, hoặc người dùng chỉ muốn đàm thoại ("hello", "tôi chỉ chat thôi", "bạn làm được gì").
2. "EXPLORE": Người dùng muốn tìm hiểu, giải thích, khám phá kiến trúc, đọc hiểu mã nguồn hoặc cấu trúc của dự án hiện tại mà KHÔNG yêu cầu sửa đổi code ("dự án này có cấu trúc gì", "giải thích file index.ts", "tech stack của project").
3. "DEV": Người dùng muốn phát triển tính năng mới, sửa lỗi, viết mã nguồn, tạo test, refactor, hoặc can thiệp kỹ thuật vào mã nguồn ("viết hàm tính giai thừa", "thêm login", "fix bug null pointer", "tạo file README").
4. "CLARIFY": Người dùng nhập câu nói cụt lủn, mơ hồ, tối nghĩa, không nêu rõ hành động, hoặc ý định chưa rõ ràng ("chưa rõ", "dự án", "sao", "làm gì", "code", "dev").

Hãy trả về DUY NHẤT một chuỗi JSON theo định dạng:
{"type": "CHAT" | "EXPLORE" | "DEV" | "CLARIFY", "reason": "Lý do ngắn gọn dưới 20 từ", "clarificationMessage": "Nếu type là CLARIFY, hãy viết câu ngắn hỏi rõ ý định"}`;

  const userPrompt = `Dự án: ${state.projectPath}
Nội dung người dùng nhập: "${state.intent}"

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

  // Fallback: If input is too short or doesn't have clear action verbs, ask to clarify
  const devActionVerbs = ['tạo', 'viết', 'thêm', 'sửa', 'fix', 'xây dựng', 'refactor', 'build', 'add', 'create', 'update', 'delete', 'hàm', 'chức năng', 'tính năng'];
  const hasDevVerb = devActionVerbs.some((v) => trimmed.includes(v));

  if (!hasDevVerb && trimmed.split(/\s+/).length <= 3) {
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
