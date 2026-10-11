import { AgentState } from '../state.js';
import { StateManager } from '../../core/state-manager.js';
import { DevWorker } from '../../terminal/dev-worker.js';
import { Logger } from '../../core/logger.js';

export async function devNode(state: AgentState): Promise<Partial<AgentState>> {
  const stateManager = new StateManager(state.projectPath);
  const currentTask = stateManager.getCurrentTask();

  if (!currentTask) {
    Logger.info('Không còn task nào cần phát triển.');
    return {
      currentPhase: 'DONE',
      isComplete: true,
    };
  }

  const isHealing = state.currentPhase === 'SELF_HEALING';

  let prompt = '';
  if (isHealing && state.lastTestResult?.bugReport) {
    const bug = state.lastTestResult.bugReport;
    Logger.agentMessage(
      'Dev',
      `[SELF-HEALING (Lần ${currentTask.retryCount + 1})] Sửa lỗi kiểm thử cho task: ${currentTask.title}`
    );
    prompt = `Tự động sửa lỗi kiểm thử cho dự án:
Nhiệm vụ: ${currentTask.title} (${currentTask.id})

⚠️ THÔNG TIN LỖI TỪ TEST RUNNER:
Tóm tắt lỗi: ${bug.summary}
Tệp tin lỗi: ${bug.failedFile || 'Không xác định'}:${bug.lineNumber || ''}

Trích xuất Stacktrace:
\`\`\`
${bug.extractedError}
\`\`\`

Yêu cầu:
1. Đọc kỹ file bị lỗi và nguyên nhân gây fail test.
2. Trực tiếp chỉnh sửa mã nguồn và bài test để sửa triệt để lỗi này.
3. Đảm bảo cấu trúc code sạch sẽ, không tạo bug mới.`;
  } else {
    Logger.agentMessage(
      'Dev',
      `[DEV_CODING] Bắt đầu viết code cho task: [${currentTask.id}] ${currentTask.title}`
    );
    stateManager.updateTaskStatus(currentTask.id, 'IN_PROGRESS');

    prompt = `Bạn là Lập trình viên chính của dự án. Hãy thực hiện nhiệm vụ sau:
Nhiệm vụ: ${currentTask.title} (${currentTask.id})
Mô tả: ${currentTask.description}

Tiêu chuẩn chấp thuận (Acceptance Criteria):
${currentTask.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n')}

Chỉ dẫn kiến trúc:
${state.architectureSummary || 'Tuân thủ kiến trúc chuẩn, code sạch sẽ, modular.'}

Yêu cầu quan trọng:
1. Tạo hoặc chỉnh sửa các file mã nguồn cần thiết để hoàn thành tính năng.
2. Tạo hoặc bổ sung unit tests tương ứng để kiểm tra tính đúng đắn của tính năng.
3. Không để lại mã giả lập hay placeholder chưa hoàn thiện.`;
  }

  const devWorker = new DevWorker();
  const result = await devWorker.runPrompt(prompt, state.projectPath);

  if (!result.success) {
    Logger.warn(`Claude CLI kết thúc với cảnh báo hoặc exitCode ${result.exitCode}. Vẫn chuyển sang Test Runner để xác thực.`);
  } else {
    Logger.success('Claude CLI đã hoàn thành lượt sinh/sửa code.');
  }

  stateManager.setPhase('RUNNING_TEST');
  stateManager.updateTaskStatus(currentTask.id, 'TESTING');

  return {
    currentPhase: 'RUNNING_TEST',
  };
}
