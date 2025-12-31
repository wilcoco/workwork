import React, { useEffect } from 'react';
import ReactFlow, { Background, MiniMap, Controls, Node, Edge, useEdgesState, useNodesState } from 'reactflow';
import 'reactflow/dist/style.css';

export function BpmnMiniView({ bpmn, height = 260 }: { bpmn: any; height?: number }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<any>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<any>>([]);

  useEffect(() => {
    try {
      const j = bpmn || {};
      const nn: Node<any>[] = Array.isArray(j.nodes)
        ? j.nodes.map((n: any, idx: number) => ({
            id: String(n.id),
            type: 'default',
            position: { x: 80 + (idx % 6) * 160, y: 60 + Math.floor(idx / 6) * 120 },
            data: { label: n.name || n.type || String(n.id) },
          }))
        : [];
      const ee: Edge<any>[] = Array.isArray(j.edges)
        ? j.edges.map((e: any, i: number) => ({ id: String(e.id || `${e.source}-${e.target}-${i}`), source: String(e.source), target: String(e.target) }))
        : [];
      setNodes(nn);
      setEdges(ee);
    } catch {
      setNodes([]);
      setEdges([]);
    }
  }, [bpmn, setNodes, setEdges]);

  return (
    <div style={{ height }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
        <Background />
        <MiniMap />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
