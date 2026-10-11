import { AgentState } from '../state.js';
import { LLMFactory } from '../../core/llm-factory.js';
import { Logger } from '../../core/logger.js';
import { StateManager } from '../../core/state-manager.js';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';
import fs from 'fs';
import path from 'path';

export async function chatNode(state: AgentState): Promise<Partial<AgentState>> {
  // 1. Scan available reports in project
  let reportsInfo = '';
  const reportsDir = path.join(state.projectPath, '.devteam', 'reports');
  if (fs.existsSync(reportsDir)) {
    try {
      const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith('.md'));
      if (files.length > 0) {
        reportsInfo =
          `Các tệp báo cáo hiện có trong dự án (.devteam/reports/):\n` +
          files.map((f) => `• .devteam/reports/${f}`).join('\n');
      }
    } catch {}
  }

  // 2. Scan current tasks / plan status
  let planInfo = '';
  try {
    const stateMgr = new StateManager(state.projectPath);
    const plan = stateMgr.getPlan();
    if (plan.tasks && plan.tasks.length > 0) {
      const pendingTasks = plan.tasks.filter((t) => t.status !== 'DONE');
      planInfo = `Hiện tại dự án có ${plan.tasks.length} task (trong đó ${pendingTasks.length} task chưa hoàn thành). Phase hiện tại: ${plan.currentPhase}.`;
    }
  } catch {}

  const systemPrompt = `Bạn là DevTeam AI - Trợ lý Multi-Agent Orchestrator thông minh, thân thiện, am hiểu kỹ thuật và nắm rõ toàn bộ tiến trình điều phối của hệ thống.
Người dùng đang trò chuyện hoặc giao tiếp đàm thoại với bạn (hỏi đáp về báo cáo, trạng thái, kết quả vừa khảo sát, hoặc hỏi han thông thường).

NGỮ CẢNH DỰ ÁN HIỆN TẠI:
- Thư mục dự án: ${state.projectPath}
${reportsInfo ? `\n${reportsInfo}\n` : ''}
${planInfo ? `\n${planInfo}\n` : ''}

QUY TẮC PHẢN HỒI:
1. Đọc kỹ lịch sử hội thoại gần nhất để nắm ngữ cảnh liên tục.
2. Nếu người dùng hỏi về "báo cáo ở đâu", "xem báo cáo", "kết quả vừa rồi", hãy chỉ rõ đường dẫn tệp báo cáo (ví dụ: .devteam/reports/LATEST_EXPLORATION_REPORT.md) hoặc giải thích rằng báo cáo đã hiển thị trên màn hình terminal và đã được lưu vào thư mục .devteam/reports.
3. TUYỆT ĐỐI KHÔNG hiểu lầm các câu như "báo cáo bạn vừa hoàn thành đó" thành việc người dùng thông báo task đã xong để đi chúc mừng/ăn mừng. Đó là câu người dùng đang chỉ rõ bản báo cáo mà họ đang hỏi!
4. Giữ phong cách tự nhiên, lịch sự, dí dỏm, súc tích và hữu ích (dưới 150 từ trừ khi người dùng yêu cầu giải thích chi tiết).
5. Nếu người dùng chỉ chào hỏi xã giao (hello, hi), hãy vui vẻ chào lại và giới thiệu sẵn sàng hỗ trợ.`;

  // 3. Prepare conversation history
  const rawMessages: BaseMessage[] = state.messages || [];
  let recentMessages = rawMessages.slice(-8);

  // Ensure conversation slice starts with a human message if available
  const firstHumanIdx = recentMessages.findIndex((m) => m._getType() === 'human');
  if (firstHumanIdx > 0) {
    recentMessages = recentMessages.slice(firstHumanIdx);
  }

  const conversationMessages: BaseMessage[] = [];
  for (const m of recentMessages) {
    const type = m._getType();
    let content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    // Limit very large reports in chat context to keep latency fast
    if (content.length > 5000) {
      content = content.slice(0, 5000) + '\n...[Nội dung báo cáo chi tiết đã được rút gọn để tối ưu context]...';
    }
    if (type === 'human') {
      conversationMessages.push(new HumanMessage(content));
    } else if (type === 'ai') {
      conversationMessages.push(new AIMessage(content));
    }
  }

  // Ensure current intent is present at the end
  const lastMsg = conversationMessages[conversationMessages.length - 1];
  const lastContent = lastMsg ? (typeof lastMsg.content === 'string' ? lastMsg.content : '') : '';
  if (!lastMsg || lastMsg._getType() !== 'human' || lastContent.trim() !== state.intent.trim()) {
    conversationMessages.push(new HumanMessage(state.intent));
  }

  let reply = 'Chào bạn! Tôi là DevTeam AI. Tôi có thể hỗ trợ bạn tìm hiểu dự án hiện tại hoặc phát triển tính năng mới bất cứ khi nào bạn cần! 😊';
  try {
    const model = LLMFactory.createModel();
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      ...conversationMessages,
    ]);
    if (typeof response.content === 'string' && response.content.trim()) {
      reply = response.content.trim();
    }
  } catch (err: any) {
    Logger.warn(`Chat Node dùng phản hồi mặc định (${err.message})`);
  }

  Logger.agentMessage('DevTeam AI', reply);

  return {
    responseMessage: reply,
    isComplete: true,
    currentPhase: 'DONE',
  };
}
