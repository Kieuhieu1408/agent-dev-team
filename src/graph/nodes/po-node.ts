import { AgentState } from '../state.js';
import { LLMFactory } from '../../core/llm-factory.js';
import { StateManager } from '../../core/state-manager.js';
import { FileSystemTool } from '../../tools/file-system.js';
import { Logger } from '../../core/logger.js';
import { settings } from '../../config/settings.js';
import chalk from 'chalk';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export async function poNode(state: AgentState): Promise<Partial<AgentState>> {
  if (settings.isHomeDirectory()) {
    Logger.error(`⛔ Không thể phát triển tính năng trực tiếp trên thư mục cá nhân (~ / ${state.projectPath})!`);
    console.log(chalk.yellow('\n👉 Hãy mở/chỉ định thư mục dự án bằng lệnh:'));
    console.log(chalk.bold.cyan('   /project <đường_dẫn>') + chalk.dim(' (Ví dụ: /project desktop/du-an-1)\n'));
    return {
      isComplete: true,
      currentPhase: 'IDLE',
      error: 'Vui lòng chọn thư mục dự án qua lệnh /project trước khi phát triển tính năng.',
    };
  }

  Logger.agentMessage('PO', `Phân tích yêu cầu nghiệp vụ: "${state.intent}"`);

  const stateManager = new StateManager(state.projectPath);
  const projectSummary = FileSystemTool.getProjectSummary(state.projectPath);

  const systemPrompt = `Bạn là một Product Owner (PO) kỹ thuật cấp cao.
Nhiệm vụ của bạn là nhận yêu cầu tính năng từ người dùng, đối chiếu với cấu trúc dự án hiện tại, và chia nhỏ thành các nhiệm vụ cụ thể (tối đa 3-5 nhiệm vụ rõ ràng) để lập trình viên và kiểm thử viên thực hiện.

Quy tắc:
1. Mỗi nhiệm vụ phải cụ thể, có thể đo lường và kiểm thử được.
2. Trả về DUY NHẤT một khối JSON hợp lệ theo định dạng sau (không thêm văn bản ngoài JSON):
{
  "tasks": [
    {
      "id": "task_01",
      "title": "Tên nhiệm vụ ngắn gọn",
      "description": "Mô tả chi tiết các tệp cần tạo/sửa đổi",
      "acceptanceCriteria": [
        "Tiêu chí 1",
        "Tiêu chí 2"
      ]
    }
  ]
}`;

  const userPrompt = `Dự án: ${state.projectPath}
Hiện trạng dự án:
${projectSummary}

Yêu cầu người dùng:
"${state.intent}"

Hãy phân tích và chia nhỏ thành danh sách tasks bằng JSON.`;

  try {
    const model = LLMFactory.createModel();
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    
    // Extract JSON block
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
        stateManager.initPlan(state.intent, 'Phân tích ban đầu bởi PO', parsed.tasks);
        Logger.success(`PO đã tạo thành công ${parsed.tasks.length} nhiệm vụ.`);
        for (const t of parsed.tasks) {
          Logger.info(`  • [${t.id}] ${t.title}`);
        }
        return {
          tasks: stateManager.getPlan().tasks,
          currentTaskId: parsed.tasks[0].id,
          currentPhase: 'PLANNING',
        };
      }
    }
  } catch (err: any) {
    Logger.warn(`PO Node không thể gọi LLM (${err.message}). Khởi tạo task mặc định.`);
  }

  // Fallback if LLM call fails or returns non-JSON
  const fallbackTasks = [
    {
      id: 'task_01',
      title: 'Hiện thực hóa tính năng & kiểm thử',
      description: `Thực hiện yêu cầu: ${state.intent}`,
      acceptanceCriteria: [
        'Mã nguồn được viết hoàn chỉnh',
        'Có unit test tương ứng và chạy vượt qua',
      ],
    },
  ];

  stateManager.initPlan(state.intent, 'Fallback Plan', fallbackTasks);
  return {
    tasks: stateManager.getPlan().tasks,
    currentTaskId: fallbackTasks[0].id,
    currentPhase: 'PLANNING',
  };
}
