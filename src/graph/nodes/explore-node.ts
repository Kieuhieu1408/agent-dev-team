import { AgentState } from '../state.js';
import { LLMFactory } from '../../core/llm-factory.js';
import { FileSystemTool } from '../../tools/file-system.js';
import { Logger } from '../../core/logger.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import fs from 'fs';
import path from 'path';

export async function exploreNode(state: AgentState): Promise<Partial<AgentState>> {
  Logger.agentMessage('Explorer', `Đang khảo sát cấu trúc dự án: ${state.projectPath}...`);

  const summary = FileSystemTool.getProjectSummary(state.projectPath);

  // Read README if exists
  let readmeSnippet = '';
  const readmePath = path.join(state.projectPath, 'README.md');
  if (fs.existsSync(readmePath)) {
    try {
      readmeSnippet = fs.readFileSync(readmePath, 'utf-8').slice(0, 1000);
    } catch {}
  }

  // Read package.json / pyproject.toml if exists
  let manifestSnippet = '';
  const pkgPath = path.join(state.projectPath, 'package.json');
  const pyPath = path.join(state.projectPath, 'pyproject.toml');
  if (fs.existsSync(pkgPath)) {
    try {
      manifestSnippet = fs.readFileSync(pkgPath, 'utf-8').slice(0, 1000);
    } catch {}
  } else if (fs.existsSync(pyPath)) {
    try {
      manifestSnippet = fs.readFileSync(pyPath, 'utf-8').slice(0, 1000);
    } catch {}
  }

  const systemPrompt = `Bạn là một Lead Solution Architect chuyên đánh giá và phân tích mã nguồn trong môi trường Terminal CLI.
Nhiệm vụ của bạn là giải đáp câu hỏi của người dùng về dự án hiện tại, giải thích cấu trúc thư mục, công nghệ sử dụng, và mục đích của dự án một cách rõ ràng, trực quan, chuyên nghiệp (dưới 200 từ).
Lưu ý về định dạng:
- Trình bày dạng văn bản trực quan cho Terminal CLI, xuống dòng rõ ràng.
- Dùng gạch đầu dòng • hoặc - cho các danh sách.
- Hạn chế các khối markdown phức tạp.`;

  const userPrompt = `Dự án: ${state.projectPath}
Câu hỏi của người dùng: "${state.intent}"

Cấu trúc tệp tin hiện tại:
${summary}

${readmeSnippet ? `README.md:\n${readmeSnippet}\n` : ''}
${manifestSnippet ? `Manifest:\n${manifestSnippet}\n` : ''}

Hãy đưa ra câu trả lời chi tiết và hữu ích cho người dùng.`;

  let answer = 'Dự án hiện tại:\n' + summary;
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
    Logger.warn(`Không thể phân tích sâu bằng LLM: ${err.message}`);
  }

  Logger.agentMessage('Explorer', answer);

  return {
    responseMessage: answer,
    isComplete: true,
    currentPhase: 'DONE',
  };
}
