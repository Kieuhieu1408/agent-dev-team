import { AgentState } from '../state.js';
import { LLMFactory } from '../../core/llm-factory.js';
import { StateManager } from '../../core/state-manager.js';
import { Logger } from '../../core/logger.js';
import { HITL } from '../../core/hitl.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export async function architectNode(state: AgentState): Promise<Partial<AgentState>> {
  Logger.agentMessage('Architect', 'Định hình kiến trúc kỹ thuật và tiêu chuẩn mã nguồn...');

  const stateManager = new StateManager(state.projectPath);
  const plan = stateManager.getPlan();

  const systemPrompt = `Bạn là một Solution Architect (SA) giàu kinh nghiệm.
Nhiệm vụ của bạn là xem xét các tasks do PO đề xuất, đưa ra tóm tắt kiến trúc kỹ thuật tổng quan (Tech Stack, cấu trúc thư mục, quy ước code, chiến lược test).
Hãy trả về một đoạn tóm tắt kiến trúc ngắn gọn và súc tích (dưới 150 từ).`;

  const userPrompt = `Dự án: ${state.projectPath}
Mục tiêu: "${state.intent}"
Danh sách Tasks hiện tại:
${plan.tasks.map((t) => `- [${t.id}] ${t.title}: ${t.description}`).join('\n')}

Hãy đưa ra chỉ dẫn kiến trúc.`;

  let archSummary = 'Tuân thủ Clean Architecture, module hóa rõ ràng, bổ sung test tương ứng.';
  try {
    const model = LLMFactory.createModel();
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);
    if (typeof response.content === 'string' && response.content.trim()) {
      archSummary = response.content.trim();
    }
  } catch (err: any) {
    Logger.warn(`Architect Node dùng chỉ dẫn mặc định (${err.message}).`);
  }

  Logger.info(`Kiến trúc: ${archSummary}`);

  // Human-in-the-Loop Confirmation Gate
  const approved = await HITL.confirmPlanningDone(plan.tasks, archSummary);

  if (!approved) {
    Logger.warn('⛔ Người dùng đã tạm dừng hoặc không đồng ý kế hoạch. Quay lại trạng thái chờ (IDLE).');
    stateManager.setPhase('IDLE');
    return {
      architectureSummary: archSummary,
      currentPhase: 'IDLE',
      isComplete: true,
      error: 'Kế hoạch đã tạm dừng do người dùng không đồng ý bước xác nhận.',
    };
  }

  Logger.success('✓ Kế hoạch đã được phê duyệt. Bắt đầu giai đoạn lập trình (DEV_CODING)...');
  stateManager.setPhase('DEV_CODING');

  return {
    architectureSummary: archSummary,
    currentPhase: 'DEV_CODING',
  };
}
