import React, { useEffect } from 'react';
import ReactFlow, { Background, MiniMap, Controls, Node, Edge, useEdgesState, useNodesState } from 'reactflow';
import 'reactflow/dist/style.css';

export function BpmnMiniView({ bpmn, height = 260 }: { bpmn: any; height?: number }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<any>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<any>>([]);

  useEffect(() => {
    try {
      const j = bpmn || {};
      const rawNodes: any[] = Array.isArray(j.nodes) ? j.nodes : [];
      const rawEdges: any[] = Array.isArray(j.edges) ? j.edges : [];
      
      // Build adjacency and find start node
      const outgoing = new Map<string, string[]>();
      const incoming = new Map<string, string[]>();
      for (const e of rawEdges) {
        const s = String(e.source);
        const t = String(e.target);
        outgoing.set(s, [...(outgoing.get(s) || []), t]);
        incoming.set(t, [...(incoming.get(t) || []), s]);
      }
      
      // Find start node (no incoming edges or type === 'start')
      const nodeIds = rawNodes.map((n: any) => String(n.id));
      let startId = rawNodes.find((n: any) => n.type === 'start')?.id;
      if (!startId) {
        startId = nodeIds.find((id) => !incoming.has(id) || incoming.get(id)!.length === 0);
      }
      if (!startId && nodeIds.length) startId = nodeIds[0];
      
      // BFS to assign vertical positions (y = level * spacing)
      const levelMap = new Map<string, number>();
      const colMap = new Map<string, number>();
      if (startId) {
        const queue: { id: string; level: number }[] = [{ id: String(startId), level: 0 }];
        const visited = new Set<string>();
        const levelCounts = new Map<number, number>();
        while (queue.length) {
          const { id, level } = queue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);
          levelMap.set(id, level);
          const col = levelCounts.get(level) || 0;
          colMap.set(id, col);
          levelCounts.set(level, col + 1);
          for (const next of (outgoing.get(id) || [])) {
            if (!visited.has(next)) queue.push({ id: next, level: level + 1 });
          }
        }
        // Handle unvisited nodes
        for (const n of rawNodes) {
          const nid = String(n.id);
          if (!visited.has(nid)) {
            const maxLevel = Math.max(...Array.from(levelMap.values()), 0) + 1;
            levelMap.set(nid, maxLevel);
            const col = levelCounts.get(maxLevel) || 0;
            colMap.set(nid, col);
            levelCounts.set(maxLevel, col + 1);
          }
        }
      }
      
      const nn: Node<any>[] = rawNodes.map((n: any, idx: number) => {
        const nid = String(n.id);
        const level = levelMap.get(nid) ?? idx;
        const col = colMap.get(nid) ?? 0;
        const nodeType = String(n.type || '');
        const isGw = nodeType === 'gateway_parallel' || nodeType === 'gateway_xor';
        const isStart = nodeType === 'start';
        const isEnd = nodeType === 'end';
        const gwColor = nodeType === 'gateway_parallel' ? '#3b82f6' : '#f97316';
        const label = isGw
          ? (nodeType === 'gateway_parallel' ? (n.name || 'AND') : (n.name || 'XOR'))
          : (n.name || n.type || nid);
        return {
          id: nid,
          type: 'default',
          position: { x: 120 + col * 180, y: 60 + level * 100 },
          data: { label: isGw ? React.createElement('span', { style: { display: 'inline-block', transform: 'rotate(-45deg)' } }, label) : label },
          style: isGw
            ? { background: gwColor + '18', border: `2px solid ${gwColor}`, borderRadius: 4, fontWeight: 700, fontSize: 11, color: gwColor, transform: 'rotate(45deg)', width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }
            : isStart
            ? { background: '#ecfdf5', border: '2px solid #16a34a', borderRadius: '50%', width: 60, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }
            : isEnd
            ? { background: '#fee2e2', border: '2px solid #dc2626', borderRadius: '50%', width: 60, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }
            : undefined,
        };
      });
      const ee: Edge<any>[] = rawEdges.map((e: any, i: number) => {
        const isLoop = !!e.isLoopBack;
        const labelParts: string[] = [];
        if (e.condition) labelParts.push(String(e.condition).length > 30 ? String(e.condition).slice(0, 28) + '..' : String(e.condition));
        if (isLoop) labelParts.push('[Loop]');
        return {
          id: String(e.id || `${e.source}-${e.target}-${i}`),
          source: String(e.source),
          target: String(e.target),
          label: labelParts.length ? labelParts.join(' ') : undefined,
          style: isLoop ? { stroke: '#f97316', strokeWidth: 2, strokeDasharray: '6 3' } : undefined,
          animated: isLoop,
          type: 'smoothstep',
        };
      });
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
