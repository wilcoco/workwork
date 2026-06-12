import React, { useEffect } from 'react';
import ReactFlow, { Background, MiniMap, Controls, Node, Edge, useEdgesState, useNodesState } from 'reactflow';
import 'reactflow/dist/style.css';
import { friendlyEdgeLabel, edgeStroke } from './bpmnVisual';

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
        const tt = String(n.taskType || '').toUpperCase();
        const isApproval = nodeType === 'task' && tt === 'APPROVAL';
        const isGw = nodeType === 'gateway_parallel' || nodeType === 'gateway_xor';
        const isStart = nodeType === 'start';
        const isEnd = nodeType === 'end';
        // 결재·분기·동시 진행은 모두 마름모(의사결정/제어 지점)로 표현
        const gwColor = isApproval ? '#d97706' : nodeType === 'gateway_parallel' ? '#0891b2' : '#7c3aed';
        const gwBadge = isApproval ? '결재' : nodeType === 'gateway_parallel' ? '동시' : '분기';
        const name = String(n.name || '');
        const label = (isGw || isApproval)
          ? React.createElement('span', { style: { display: 'inline-block', transform: 'rotate(-45deg)', textAlign: 'center', lineHeight: 1.15 } },
              React.createElement('div', { style: { fontWeight: 800 } }, gwBadge),
              isApproval && name ? React.createElement('div', { style: { fontSize: 8, fontWeight: 600, maxWidth: 52, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: name }, name) : null)
          : (name || n.type || nid);
        return {
          id: nid,
          type: 'default',
          position: { x: 120 + col * 180, y: 60 + level * 100 },
          data: { label },
          style: (isGw || isApproval)
            ? { background: gwColor + '18', border: `2px solid ${gwColor}`, borderRadius: 6, fontWeight: 700, fontSize: 10, color: gwColor, transform: 'rotate(45deg)', width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }
            : isStart
            ? { background: '#ecfdf5', border: '2px solid #16a34a', borderRadius: '50%', width: 60, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }
            : isEnd
            ? { background: '#fee2e2', border: '2px solid #dc2626', borderRadius: '50%', width: 60, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }
            : { borderRadius: 10, fontSize: 11 },
        };
      });
      const ee: Edge<any>[] = rawEdges.map((e: any, i: number) => {
        const isLoop = !!e.isLoopBack;
        const cond = e.condition ? String(e.condition) : '';
        const stroke = edgeStroke(cond, isLoop);
        const label = friendlyEdgeLabel(cond, isLoop);
        return {
          id: String(e.id || `${e.source}-${e.target}-${i}`),
          source: String(e.source),
          target: String(e.target),
          label: label && label.length > 24 ? label.slice(0, 22) + '..' : label,
          labelStyle: stroke ? { fill: stroke, fontWeight: 700, fontSize: 10 } : { fontSize: 10 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
          style: isLoop
            ? { stroke: '#dc2626', strokeWidth: 2, strokeDasharray: '6 3' }
            : stroke ? { stroke, strokeWidth: 2 } : undefined,
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
