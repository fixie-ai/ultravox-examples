import React, { useEffect, useMemo, useRef } from 'react';
import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Edge,
  Handle,
  MarkerType,
  Node,
  NodeProps,
  Position,
  ReactFlow,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getAvailableActions, getAction } from '../../../engine/stateMachine';
import { AnyScenario } from '../../../engine/types';
import { ANY_STATE_NODE, buildGraphModel, GraphNode } from './graphModel';
import { PathSummary } from '../../shared/callModel';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 46;

type Status = 'current' | 'visited' | 'skipped' | 'next' | 'idle';

// React Flow requires node data to be a plain record.
type StateNodeData = GraphNode &
  Record<string, unknown> & {
    status: Status;
    orders: number[];
    selected: boolean;
  };

const STATUS_STYLES: Record<Status, string> = {
  current: 'border-blue-500 bg-blue-50 text-blue-900 shadow-md shadow-blue-500/30',
  visited: 'border-green-400 bg-green-50 text-green-900',
  skipped: 'border-green-300 border-dashed bg-white text-green-800',
  next: 'border-amber-300 bg-amber-50 text-amber-900',
  idle: 'border-slate-300 bg-white text-slate-500',
};

const StateNode: React.FC<NodeProps<Node<StateNodeData>>> = ({ data }) => (
  <div
    className={`rounded-md border-2 px-2 py-1 text-left ${data.global ? 'border-dashed border-slate-400 bg-slate-50 text-slate-600' : STATUS_STYLES[data.status]} ${data.selected ? 'ring-2 ring-offset-1 ring-indigo-400' : ''}`}
    style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    title={data.description}
  >
    <Handle type="target" position={Position.Top} className="!bg-slate-400" />
    <div className="flex items-center justify-between gap-1">
      <span className="font-mono text-xs font-semibold truncate">{data.label}</span>
      <span className="flex gap-0.5">
        {data.orders.map((order) => (
          <span key={order} className="rounded-full bg-slate-700 text-white text-[10px] px-1.5 leading-4">
            {order}
          </span>
        ))}
      </span>
    </div>
    <div className="text-[10px] leading-tight opacity-80">{data.description}</div>
    {data.status === 'skipped' && <div className="text-[10px] italic">skipped (already answered)</div>}
    {data.loops.length > 0 && <div className="text-[10px] font-mono opacity-70">↻ {data.loops.join(', ')}</div>}
    <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
  </div>
);

const nodeTypes = { state: StateNode };

/** Re-fits the graph whenever its panel changes size (fitView alone only runs once, at first render). */
const FitOnResize: React.FC<{ container: React.RefObject<HTMLDivElement | null> }> = ({ container }) => {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => fitView({ padding: 0.03 }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [container, fitView]);
  return null;
};

interface StateGraphProps {
  scenario: AnyScenario;
  currentState: string;
  path: PathSummary;
  selectedState?: string;
  onSelect: (state: string) => void;
}

/** The scenario's state machine as a graph, with the path this call took. */
const StateGraph: React.FC<StateGraphProps> = ({ scenario, currentState, path, selectedState, onSelect }) => {
  const model = useMemo(() => buildGraphModel(scenario), [scenario]);
  const container = useRef<HTMLDivElement>(null);

  // Layout only depends on the scenario.
  const positions = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: 'TB', nodesep: 18, ranksep: 30 });
    graph.setDefaultEdgeLabel(() => ({}));
    model.nodes.forEach((node) => graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
    model.edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
    dagre.layout(graph);
    return Object.fromEntries(
      model.nodes.map((node) => {
        const { x, y } = graph.node(node.id);
        return [node.id, { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 }];
      })
    );
  }, [model]);

  const nextStates = useMemo(
    () => new Set(getAvailableActions(scenario, currentState).map((action) => getAction(scenario, currentState, action)!.nextState)),
    [scenario, currentState]
  );

  const desiredNodes: Node<StateNodeData>[] = model.nodes.map((node) => {
    const visits = path.visits.filter((visit) => visit.state === node.id);
    const status: Status =
      node.id === currentState
        ? 'current'
        : visits.length && visits.every((visit) => visit.skipped)
          ? 'skipped'
          : visits.length
            ? 'visited'
            : nextStates.has(node.id)
              ? 'next'
              : 'idle';
    return {
      id: node.id,
      type: 'state',
      position: positions[node.id],
      data: { ...node, status, orders: visits.map((visit) => visit.order), selected: node.id === selectedState },
      draggable: false,
    };
  });

  // React Flow keeps each node's measured size on the node objects (via onNodesChange) and hides nodes it
  // hasn't measured. Rebuilding plain node objects on every update would drop those measurements and hide the
  // whole graph once data starts streaming in, so update the data on the nodes React Flow already has.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StateNodeData>>(desiredNodes);
  const signature = JSON.stringify(desiredNodes.map((node) => [node.id, node.data.status, node.data.orders, node.data.selected]));
  useEffect(() => {
    setNodes((current) =>
      desiredNodes.map((node) => {
        const existing = current.find((candidate) => candidate.id === node.id);
        return existing ? { ...existing, data: node.data, position: node.position } : node;
      })
    );
    // desiredNodes is rebuilt every render; the signature captures what actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, setNodes]);

  const lastStep = path.visits.length > 1 ? `${path.visits[path.visits.length - 2].state}->${currentState}` : undefined;
  const edges: Edge[] = model.edges.map((edge) => {
    const taken = edge.global ? path.takenActions.has(edge.label) : path.takenEdges.has(`${edge.source}->${edge.target}`);
    const possible = edge.source === currentState || (edge.global && edge.target !== currentState);
    const color = taken ? '#22c55e' : possible ? '#f59e0b' : '#cbd5e1';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: `${edge.source}->${edge.target}` === lastStep,
      style: { stroke: color, strokeWidth: taken ? 2.5 : 1.5, strokeDasharray: edge.global ? '6 4' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      labelStyle: { fontSize: 10, fontFamily: 'ui-monospace, monospace', fill: '#475569' },
      labelBgStyle: { fill: '#f8fafc' },
    };
  });

  return (
    <div ref={container} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => node.id !== ANY_STATE_NODE && onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.03 }}
        nodesConnectable={false}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background gap={16} color="#e2e8f0" />
        <Controls showInteractive={false} />
        <FitOnResize container={container} />
      </ReactFlow>
    </div>
  );
};

export default StateGraph;
