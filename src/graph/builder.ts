import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentStateAnnotation, AgentState } from './state.js';
import { supervisorNode } from './nodes/supervisor-node.js';
import { chatNode } from './nodes/chat-node.js';
import { exploreNode } from './nodes/explore-node.js';
import { poNode } from './nodes/po-node.js';
import { architectNode } from './nodes/architect-node.js';
import { devNode } from './nodes/dev-node.js';
import { testerNode } from './nodes/tester-node.js';
import {
  routeAfterSupervisor,
  routeAfterPO,
  routeAfterArchitect,
  routeAfterTester,
} from './router.js';

export function buildDevTeamGraph() {
  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('supervisor', supervisorNode)
    .addNode('chat', chatNode)
    .addNode('explore', exploreNode)
    .addNode('po', poNode)
    .addNode('architect', architectNode)
    .addNode('dev', devNode)
    .addNode('tester', testerNode)
    .addEdge(START, 'supervisor')
    .addConditionalEdges('supervisor', (state: AgentState) => routeAfterSupervisor(state), {
      chat: 'chat',
      explore: 'explore',
      po: 'po',
    })
    .addEdge('chat', END)
    .addEdge('explore', END)
    .addConditionalEdges('po', (state: AgentState) => routeAfterPO(state), {
      architect: 'architect',
      __end__: END,
    })
    .addConditionalEdges('architect', (state: AgentState) => routeAfterArchitect(state), {
      dev: 'dev',
      __end__: END,
    })
    .addEdge('dev', 'tester')
    .addConditionalEdges('tester', (state: AgentState) => routeAfterTester(state), {
      dev: 'dev',
      __end__: END,
    });

  return workflow.compile();
}
