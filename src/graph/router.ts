import { AgentState } from './state.js';

export function routeAfterArchitect(state: AgentState): string {
  if (state.isComplete || state.currentPhase === 'IDLE' || state.error) {
    return '__end__';
  }
  return 'dev';
}

export function routeAfterTester(state: AgentState): string {
  if (state.isComplete || state.currentPhase === 'DONE') {
    return '__end__';
  }

  if (state.currentPhase === 'SELF_HEALING' || state.currentPhase === 'DEV_CODING') {
    return 'dev';
  }

  return '__end__';
}

