import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from './state.js';
import { poNode } from './nodes/po-node.js';
import { architectNode } from './nodes/architect-node.js';
import { devNode } from './nodes/dev-node.js';
import { testerNode } from './nodes/tester-node.js';
import { routeAfterTester } from './router.js';

export function buildDevTeamGraph() {
  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('po', poNode)
    .addNode('architect', architectNode)
    .addNode('dev', devNode)
    .addNode('tester', testerNode)
    .addEdge(START, 'po')
    .addEdge('po', 'architect')
    .addEdge('architect', 'dev')
    .addEdge('dev', 'tester')
    .addConditionalEdges('tester', (state: AgentState) => routeAfterTester(state), {
      dev: 'dev',
      __end__: END,
    });

  return workflow.compile();
}
