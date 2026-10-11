import { AgentState } from '../state.js';
import { LLMFactory } from '../../core/llm-factory.js';
import { Logger } from '../../core/logger.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export async function chatNode(state: AgentState): Promise<Partial<AgentState>> {
  const systemPrompt = `Bạn là DevTeam AI - Trợ lý Multi-Agent Orchestrator thông minh, thân thiện và am hiểu kỹ thuật.
Người dùng đang trò chuyện hoặc giao tiếp đàm thoại với bạn (không phải giao việc viết code).
Hãy phản hồi người dùng một cách tự nhiên, lịch sự, dí dỏm và súc tích (dưới 100 từ).
Nếu người dùng nói những câu như "ủa tôi chỉ chat thôi", hãy vui vẻ xác nhận bạn hiểu và sẵn sàng đàm thoại hoặc hướng dẫn khi họ cần.`;

  let reply = 'Chào bạn! Tôi là DevTeam AI. Tôi có thể hỗ trợ bạn tìm hiểu dự án hiện tại hoặc phát triển tính năng mới bất cứ khi nào bạn cần! 😊';
  try {
    const model = LLMFactory.createModel();
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(state.intent),
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
