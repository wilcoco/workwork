import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  Connection,
  Edge,
  Node,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';

export function BpmnEditor({ jsonText, onChangeJson }: { jsonText: string; onChangeJson: (t: string) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<any>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<any>>([]);
  const idCounter = useRef(1);
  const importingRef = useRef(false);

  const toJson = useCallback(() => {
    const j = {
      nodes: nodes.map((n: Node<any>) => ({
        id: String(n.id),
        type: String(n.type || 'task'),
        name: (n.data && (n.data as any).name) || '',
        taskType: (n.data && (n.data as any).taskType) || undefined,
        description: (n.data && (n.data as any).description) || undefined,
        assigneeHint: (n.data && (n.data as any).assigneeHint) || undefined,
        stageLabel: (n.data && (n.data as any).stageLabel) || undefined,
        deadlineOffsetDays: (n.data && (n.data as any).deadlineOffsetDays) ?? undefined,
        approvalUserIds: (n.data && (n.data as any).approvalUserIds) || undefined,
      })),
      edges: edges.map((e: Edge<any>) => ({ id: String(e.id), source: String(e.source), target: String(e.target) })),
    };
    onChangeJson(JSON.stringify(j, null, 2));
  }, [nodes, edges, onChangeJson]);

  const fromJson = useCallback((txt: string) => {
    try {
      const j = JSON.parse(txt || '{}');
      const nn: Node<any>[] = (j.nodes || []).map((n: any, idx: number) => ({
        id: String(n.id),
        type: String(n.type || 'task'),
        position: { x: 80 + (idx % 6) * 160, y: 80 + Math.floor(idx / 6) * 140 },
        data: {
          name: n.name || '',
          taskType: n.taskType || undefined,
          description: n.description || undefined,
          assigneeHint: n.assigneeHint || undefined,
          stageLabel: n.stageLabel || undefined,
          deadlineOffsetDays: n.deadlineOffsetDays ?? undefined,
          approvalUserIds: n.approvalUserIds || undefined,
        },
      }));
      const ee: Edge<any>[] = (j.edges || []).map((e: any) => ({ id: String(e.id || `${e.source}-${e.target}`), source: String(e.source), target: String(e.target) }));
      setNodes(nn);
      setEdges(ee);
    } catch {
      // ignore
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    if (jsonText) fromJson(jsonText);
  }, []); // init only

  // Auto-sync: whenever graph changes, reflect to parent JSON
  useEffect(() => {
    if (importingRef.current) { importingRef.current = false; return; }
    toJson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // When parent JSON changes (e.g., auto-linearize), import into editor without causing emit loop
  useEffect(() => {
    if (!jsonText) return;
    importingRef.current = true;
    fromJson(jsonText);
  }, [jsonText, fromJson]);

  const onConnect = useCallback((params: Connection) => setEdges((eds: Edge<any>[]) => addEdge({ ...params, id: `${params.source}-${params.target}-${Date.now()}` }, eds)), [setEdges]);

  const addNode = (type: string) => {
    const id = `n${Date.now()}_${idCounter.current++}`;
    const label = type === 'start' ? 'Start' : type === 'end' ? 'End' : type.startsWith('gateway') ? (type === 'gateway_parallel' ? 'AND' : 'XOR') : 'Task';
    const data: any = type === 'task' ? { name: '새 과제', taskType: 'TASK' } : { name: label };
    const n: Node<any> = {
      id,
      type,
      position: { x: 80 + Math.random() * 480, y: 80 + Math.random() * 320 },
      data,
    };
    setNodes((nds: Node<any>[]) => nds.concat(n));
  };

  const onNodeLabelChange = (id: string, key: string, value: any) => {
    setNodes((nds: Node<any>[]) => nds.map((n: Node<any>) => (n.id === id ? { ...n, data: { ...(n.data || {}), [key]: value } } : n)));
  };

  const sidePanel = useMemo(() => {
    const selected = nodes[0];
    return (
      <div style={{ minWidth: 260, borderLeft: '1px solid #e5e7eb', padding: 8, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn" onClick={() => addNode('start')}>Start</button>
          <button type="button" className="btn" onClick={() => addNode('task')}>Task</button>
          <button type="button" className="btn" onClick={() => addNode('gateway_parallel')}>AND</button>
          <button type="button" className="btn" onClick={() => addNode('gateway_xor')}>XOR</button>
          <button type="button" className="btn" onClick={() => addNode('end')}>End</button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn" onClick={toJson}>그래프→JSON 반영</button>
          <button type="button" className="btn" onClick={() => fromJson(jsonText)}>JSON→그래프 불러오기</button>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>노드를 선택해 속성을 수정하세요.</div>
        {nodes.map((n: Node<any>) => (
          n.type === 'task' ? (
            <div key={n.id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
              <div style={{ fontWeight: 600 }}>{String(n.id)}</div>
              <label>이름<input value={(n.data as any)?.name || ''} onChange={(e) => onNodeLabelChange(n.id, 'name', e.target.value)} /></label>
              <label>타입<select value={(n.data as any)?.taskType || 'TASK'} onChange={(e) => onNodeLabelChange(n.id, 'taskType', e.target.value)}>
                <option value="TASK">TASK</option>
                <option value="WORKLOG">WORKLOG</option>
                <option value="COOPERATION">COOPERATION</option>
                <option value="APPROVAL">APPROVAL</option>
              </select></label>
              <label>설명<textarea rows={2} value={(n.data as any)?.description || ''} onChange={(e) => onNodeLabelChange(n.id, 'description', e.target.value)} /></label>
              <label>담당자 힌트<input value={(n.data as any)?.assigneeHint || ''} onChange={(e) => onNodeLabelChange(n.id, 'assigneeHint', e.target.value)} /></label>
              <label>스테이지<input value={(n.data as any)?.stageLabel || ''} onChange={(e) => onNodeLabelChange(n.id, 'stageLabel', e.target.value)} /></label>
              <label>마감 오프셋(D+)<input type="number" value={(n.data as any)?.deadlineOffsetDays ?? ''} onChange={(e) => onNodeLabelChange(n.id, 'deadlineOffsetDays', e.target.value ? Number(e.target.value) : undefined)} /></label>
              <label>담당자 순번(쉼표로 ID 나열)
                <input
                  placeholder="userA,userB,userC"
                  value={(n.data as any)?.approvalUserIds || ''}
                  onChange={(e) => onNodeLabelChange(n.id, 'approvalUserIds', e.target.value)}
                />
              </label>
            </div>
          ) : (
            <div key={n.id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
              <div style={{ fontWeight: 600 }}>{String(n.id)} · {String(n.type)}</div>
            </div>
          )
        ))}
      </div>
    );
  }, [nodes, toJson, fromJson, jsonText]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 8, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ height: 480 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
      </div>
      {sidePanel}
    </div>
  );
}
