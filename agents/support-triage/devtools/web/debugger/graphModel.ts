import { isTerminal } from '../../../engine/stateMachine';
import { AnyScenario } from '../../../engine/types';

// The scenario's states as a graph: one node per state, one edge per
// (state, next state) pair. Global actions get a single "any state" node, and
// self-loops (like account_not_found) are listed on their node instead of
// drawn as edges.

export const ANY_STATE_NODE = '__any_state__';

export interface GraphNode {
  id: string;
  label: string;
  description: string;
  terminal: boolean;
  /** Actions that loop back to this state. */
  loops: string[];
  /** True for the "any state" node that global actions start from. */
  global?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  /** Action names, joined when several lead to the same state. */
  label: string;
  global: boolean;
}

export function buildGraphModel(scenario: AnyScenario): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edgeLabels = new Map<string, string[]>();

  for (const [state, definition] of Object.entries(scenario.states)) {
    const loops: string[] = [];
    for (const [action, def] of Object.entries(definition.actions)) {
      if (!def) continue;
      if (def.nextState === state) {
        loops.push(action);
        continue;
      }
      const key = `${state}->${def.nextState}`;
      edgeLabels.set(key, [...(edgeLabels.get(key) ?? []), action]);
    }
    nodes.push({ id: state, label: state, description: definition.description, terminal: isTerminal(scenario, state), loops });
  }

  const edges: GraphEdge[] = [...edgeLabels.entries()].map(([key, actions]) => {
    const [source, target] = key.split('->');
    return { id: key, source, target, label: actions.join(' / '), global: false };
  });

  const globals = Object.entries(scenario.globalActions ?? {});
  if (globals.length) {
    nodes.push({
      id: ANY_STATE_NODE,
      label: 'any state',
      description: 'Global actions, valid from every state except terminal ones',
      terminal: false,
      loops: [],
      global: true,
    });
    for (const [action, def] of globals) {
      if (!def) continue;
      edges.push({
        id: `${ANY_STATE_NODE}->${def.nextState}:${action}`,
        source: ANY_STATE_NODE,
        target: def.nextState,
        label: action,
        global: true,
      });
    }
  }

  return { nodes, edges };
}
