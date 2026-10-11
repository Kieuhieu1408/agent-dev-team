import { Annotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { DevTeamPhase, TaskItem } from '../core/state-manager.js';
import { TestResult } from '../terminal/test-runner.js';

export type RequestType = 'CHAT' | 'EXPLORE' | 'DEV' | 'CLARIFY';

export const AgentStateAnnotation = Annotation.Root({
  intent: Annotation<string>(),
  requestType: Annotation<RequestType>({
    reducer: (_, next) => next,
    default: () => 'DEV',
  }),
  responseMessage: Annotation<string | undefined>(),
  projectPath: Annotation<string>(),
  architectureSummary: Annotation<string | undefined>(),
  currentPhase: Annotation<DevTeamPhase>(),
  currentTaskId: Annotation<string | undefined>(),
  tasks: Annotation<TaskItem[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),
  lastTestResult: Annotation<TestResult | undefined>(),
  retryCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  isComplete: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, next) => curr.concat(next),
    default: () => [],
  }),
  error: Annotation<string | undefined>(),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
