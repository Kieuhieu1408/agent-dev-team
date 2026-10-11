import { AgentState } from '../state.js';
import { StateManager } from '../../core/state-manager.js';
import { TestRunner } from '../../terminal/test-runner.js';
import { Logger } from '../../core/logger.js';
import { settings } from '../../config/settings.js';
import { HITL } from '../../core/hitl.js';

export async function testerNode(state: AgentState): Promise<Partial<AgentState>> {
  const stateManager = new StateManager(state.projectPath);
  const currentTask = stateManager.getCurrentTask();
  const config = settings.get();

  if (!currentTask) {
    Logger.info('Không có task nào đang chờ test.');
    return {
      currentPhase: 'DONE',
      isComplete: true,
    };
  }

  Logger.agentMessage(
    'Tester',
    `Thực thi bộ kiểm thử độc lập cho task: [${currentTask.id}] ${currentTask.title}`
  );

  const testRunner = new TestRunner();
  const result = await testRunner.runTests(state.projectPath);

  if (result.success) {
    Logger.success(`🎉 Task [${currentTask.id}] đã vượt qua toàn bộ bài kiểm thử!`);
    stateManager.updateTaskStatus(currentTask.id, 'DONE');
    
    const nextTask = stateManager.moveToNextTask();
    if (nextTask) {
      Logger.info(`Chuyển sang nhiệm vụ tiếp theo: [${nextTask.id}] ${nextTask.title}`);
      stateManager.setPhase('DEV_CODING');
      return {
        currentPhase: 'DEV_CODING',
        currentTaskId: nextTask.id,
        lastTestResult: result,
        retryCount: 0,
      };
    } else {
      Logger.success('🚀 Tất cả nhiệm vụ trong kế hoạch đã hoàn thành xuất sắc!');
      stateManager.setPhase('DONE');
      return {
        currentPhase: 'DONE',
        isComplete: true,
        lastTestResult: result,
      };
    }
  } else {
    // Tests failed!
    const newRetryCount = currentTask.retryCount + 1;
    stateManager.updateTaskStatus(
      currentTask.id,
      'SELF_HEALING',
      result.bugReport ? result.bugReport.extractedError : result.output
    );

    if (newRetryCount >= config.maxRetries) {
      Logger.error(
        `⛔ Circuit Breaker kích hoạt: Task [${currentTask.id}] đã thử sửa ${newRetryCount} lần nhưng vẫn thất bại.`
      );
      stateManager.updateTaskStatus(currentTask.id, 'FAILED');
      stateManager.setPhase('DONE');
      return {
        currentPhase: 'DONE',
        isComplete: true,
        lastTestResult: result,
        error: `Task ${currentTask.id} thất bại sau ${newRetryCount} lần tự sửa lỗi.`,
      };
    }

    const errorSummary = result.bugReport?.extractedError || result.output || 'Kiểm thử thất bại.';
    const approveSelfHealing = await HITL.confirmSelfHealing(
      currentTask.retryCount,
      config.maxRetries,
      errorSummary
    );

    if (!approveSelfHealing) {
      Logger.warn(`⛔ Người dùng đã từ chối kích hoạt Self-Healing cho Task [${currentTask.id}].`);
      stateManager.updateTaskStatus(currentTask.id, 'FAILED');
      stateManager.setPhase('DONE');
      return {
        currentPhase: 'DONE',
        isComplete: true,
        lastTestResult: result,
        error: `Quá trình tự sửa lỗi cho task ${currentTask.id} bị từ chối bởi người dùng.`,
      };
    }

    Logger.warn(
      `🔁 Kích hoạt Closed-Loop Self-Healing (Lần ${newRetryCount}/${config.maxRetries}). Đẩy lỗi sang DevWorker...`
    );
    stateManager.setPhase('SELF_HEALING');
    return {
      currentPhase: 'SELF_HEALING',
      lastTestResult: result,
      retryCount: newRetryCount,
    };
  }
}
