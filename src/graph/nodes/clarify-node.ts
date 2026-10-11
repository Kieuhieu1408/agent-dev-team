import { AgentState } from '../state.js';
import { Logger } from '../../core/logger.js';

export async function clarifyNode(state: AgentState): Promise<Partial<AgentState>> {
  const reply =
    state.responseMessage ||
    'Tôi chưa rõ đây là gì, bạn hãy nói rõ ý định của mình. (Ví dụ: Bạn muốn trò chuyện, tìm hiểu dự án hiện tại hay phát triển tính năng mới?)';

  Logger.agentMessage('DevTeam AI', reply);

  return {
    responseMessage: reply,
    isComplete: true,
    currentPhase: 'DONE',
  };
}
