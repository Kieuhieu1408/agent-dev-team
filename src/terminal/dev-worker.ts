import { ClaudeWorker, ClaudeWorkerResult } from './claude-worker.js';

export type DevWorkerResult = ClaudeWorkerResult;

export class DevWorker extends ClaudeWorker {
  constructor(sessionName: string = 'dev-worker') {
    super({ sessionName, role: 'DEVELOPER' });
  }
}
