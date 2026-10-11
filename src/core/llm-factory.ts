import { ChatOpenAI } from '@langchain/openai';
import { settings } from '../config/settings.js';
import { TokenTracker } from './token-tracker.js';

export class LLMFactory {
  public static createModel(customModel?: string): ChatOpenAI {
    const config = settings.get();

    if (!config.apiKey) {
      throw new Error(
        'Chưa cấu hình API Key! Vui lòng dùng lệnh `/api-key sk-...` hoặc thiết lập LLM_API_KEY trong .env'
      );
    }

    return new ChatOpenAI({
      configuration: {
        baseURL: config.providerUrl,
      },
      apiKey: config.apiKey,
      modelName: customModel || config.model,
      temperature: 0.2,
      maxRetries: 2,
      callbacks: [TokenTracker.getInstance().createCallbackHandler()],
    });
  }
}
