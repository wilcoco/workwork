import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  Connection,
  Edge,
  Node,
  Position,
  Handle,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';

function LabeledNode({ data }: { data: any }) {
  const kind = data?.kind as string | undefined;
  const bg = kind === 'start' ? '#ecfdf5' : kind === 'end' ? '#fee2e2' : '#ffffff';
  const bd = kind === 'start' ? '#16a34a' : kind === 'end' ? '#dc2626' : '#cbd5e1';
  return (
    <div style={{
      padding: 8,
      border: `1px solid ${bd}`,
      borderRadius: 6,
      background: bg,
      minWidth: 160,
      textAlign: 'center',
      fontSize: 12,
      fontWeight: 600,
    }}>
      <Handle type="target" position={Position.Top} />
      <div>{data?.label || data?.name || ''}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function BpmnEditor({ jsonText, onChangeJson }: { jsonText: string; onChangeJson: (t: string) => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<any>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<any>>([]);
  const idCounter = useRef(1);
  const importingRef = useRef(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const nodeCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const edgeCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const nodeTypes = useMemo(() => ({
    start: LabeledNode,
    end: LabeledNode,
    task: LabeledNode,
    gateway_parallel: LabeledNode,
    gateway_xor: LabeledNode,
  }), []);
  const defaultEdgeOptions = useMemo(() => ({ type: 'smoothstep' as const }), []);

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
      edges: edges.map((e: Edge<any>) => ({ id: String(e.id), source: String(e.source), target: String(e.target), condition: (e as any).data?.condition })),
    };
    onChangeJson(JSON.stringify(j, null, 2));
  }, [nodes, edges, onChangeJson]);

  const fromJson = useCallback((txt: string) => {
    try {
      const j = JSON.parse(txt || '{}');
      const nn: Node<any>[] = (j.nodes || []).map((n: any, idx: number) => {
        const type = String(n.type || 'task');
        const label = type === 'start'
          ? 'Start'
          : type === 'end'
          ? 'End'
          : (n.name || (type === 'gateway_parallel' ? 'AND' : type === 'gateway_xor' ? 'XOR' : ''));
        return {
          id: String(n.id),
          type,
          position: { x: 180, y: 60 + idx * 120 },
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
          style: { width: 180 },
          data: {
            name: n.name || '',
            taskType: n.taskType || undefined,
            description: n.description || undefined,
            assigneeHint: n.assigneeHint || undefined,
            stageLabel: n.stageLabel || undefined,
            deadlineOffsetDays: n.deadlineOffsetDays ?? undefined,
            approvalUserIds: n.approvalUserIds || undefined,
            label,
            kind: type,
          },
        } as Node<any>;
      });
      const ee: Edge<any>[] = (j.edges || []).map((e: any) => ({ id: String(e.id || `${e.source}-${e.target}`), source: String(e.source), target: String(e.target), data: e.condition ? { condition: String(e.condition) } : undefined, label: e.condition ? String(e.condition) : undefined }));
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

  const onSelectionChange = useCallback((sel: { nodes?: Node[]; edges?: Edge[] }) => {
    const sn = (sel.nodes || []).find((n: any) => n.selected);
    const se = (sel.edges || []).find((e: any) => e.selected);
    const nid = sn ? String(sn.id) : null;
    const eid = se ? String(se.id) : null;
    setSelectedNodeId(nid);
    setSelectedEdgeId(eid);
  }, []);

  useEffect(() => {
    const el = selectedNodeId ? nodeCardRefs.current[selectedNodeId] : (selectedEdgeId ? edgeCardRefs.current[selectedEdgeId] : null);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [selectedNodeId, selectedEdgeId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (selectedNodeId) {
        removeNode(selectedNodeId);
      } else if (selectedEdgeId) {
        removeEdge(selectedEdgeId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNodeId, selectedEdgeId]);

  function removeNode(id: string) {
    setNodes((nds: Node<any>[]) => nds.filter((n) => String(n.id) !== id));
    setEdges((eds: Edge<any>[]) => eds.filter((e) => String(e.source) !== id && String(e.target) !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  }

  function removeEdge(id: string) {
    setEdges((eds: Edge<any>[]) => eds.filter((e) => String(e.id) !== id));
    if (selectedEdgeId === id) setSelectedEdgeId(null);
  }

  const addNode = (type: string) => {
    const id = `n${Date.now()}_${idCounter.current++}`;
    const label = type === 'start' ? 'Start' : type === 'end' ? 'End' : type.startsWith('gateway') ? (type === 'gateway_parallel' ? 'AND' : 'XOR') : '새 과제';
    const isTask = type === 'task';
    const nextY = (nodes.length ? Math.max(...nodes.map((n) => n.position.y || 0)) + 120 : 60);
    const n: Node<any> = {
      id,
      type,
      position: { x: 180, y: nextY },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      style: { width: 180 },
      data: isTask ? { name: '새 과제', taskType: 'TASK', label, kind: type } : { name: label, label, kind: type },
    };
    setNodes((nds: Node<any>[]) => nds.concat(n));
  };

  const onNodeLabelChange = (id: string, key: string, value: any) => {
    setNodes((nds: Node<any>[]) => nds.map((n: Node<any>) => {
      if (n.id !== id) return n;
      const newData: any = { ...(n.data || {}), [key]: value };
      if (key === 'name') {
        newData.label = value;
      }
      return { ...n, data: newData };
    }));
  };

  const sidePanel = useMemo(() => {
    return (
      <div ref={(r) => (panelRef.current = r)} style={{ minWidth: 260, borderLeft: '1px solid #e5e7eb', padding: 8, display: 'grid', gap: 8, maxHeight: 480, overflow: 'auto' }}>
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
          <button type="button" className="btn" onClick={() => setNodes((nds: Node<any>[]) => nds.map((n: Node<any>, idx: number) => ({ ...n, position: { x: 180, y: 60 + idx * 120 } })))}>세로 정렬</button>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>그래프에서 노드/엣지를 선택하면 여기 상세가 하이라이트되며 스크롤됩니다.</div>

        <h4>노드</h4>
        {nodes.length === 0 && <div style={{ fontSize: 12, color: '#6b7280' }}>노드를 추가하세요.</div>}
        {nodes.map((n: Node<any>) => (
          <div
            key={n.id}
            ref={(r) => { nodeCardRefs.current[String(n.id)] = r; }}
            style={{ border: '1px solid ' + (String(n.id) === selectedNodeId ? '#0F3D73' : '#e5e7eb'), boxShadow: String(n.id) === selectedNodeId ? '0 0 0 2px rgba(15,61,115,0.2)' : 'none', borderRadius: 6, padding: 8, background: String(n.id) === selectedNodeId ? '#F0F6FD' : '#fff' }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 600 }}>{String(n.id)} · {String(n.type)}</div>
              <button type="button" className="btn btn-ghost" onClick={() => removeNode(String(n.id))}>삭제</button>
            </div>
            {n.type === 'task' && (
              <>
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
              </>
            )}
            {(n.type === 'gateway_parallel' || n.type === 'gateway_xor') && (
              <>
                <label>제목<input value={(n.data as any)?.name || ''} onChange={(e) => onNodeLabelChange(n.id, 'name', e.target.value)} /></label>
              </>
            )}
          </div>
        ))}

        <h4>엣지</h4>
        {edges.length === 0 && <div style={{ fontSize: 12, color: '#6b7280' }}>엣지를 추가하세요(캔버스에서 연결).</div>}
        {edges.map((e: Edge<any>) => (
          <div
            key={e.id}
            ref={(r) => { edgeCardRefs.current[String(e.id)] = r; }}
            style={{ border: '1px solid ' + (String(e.id) === selectedEdgeId ? '#0F3D73' : '#e5e7eb'), boxShadow: String(e.id) === selectedEdgeId ? '0 0 0 2px rgba(15,61,115,0.2)' : 'none', borderRadius: 6, padding: 8, background: String(e.id) === selectedEdgeId ? '#F0F6FD' : '#fff' }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 600 }}>{String(e.id)}</div>
              <button type="button" className="btn btn-ghost" onClick={() => removeEdge(String(e.id))}>삭제</button>
            </div>
            <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <label>
                Source
                <input value={String(e.source)} readOnly />
              </label>
              <label>
                Target
                <input value={String(e.target)} readOnly />
              </label>
              <label>
                조건(XOR)
                <input
                  value={((e as any).data?.condition || '')}
                  onChange={(ev) => {
                    const val = ev.target.value;
                    setEdges((prev: Edge<any>[]) => prev.map((x) => (String(x.id) === String(e.id) ? { ...x, data: { ...(x as any).data, condition: val }, label: val || undefined } : x)));
                  }}
                />
              </label>
            </div>
          </div>
        ))}
      </div>
    );
  }, [nodes, toJson, fromJson, jsonText, edges, selectedNodeId, selectedEdgeId]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 8, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ height: 480 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange as any}
          onNodeClick={(_, n) => { setSelectedNodeId(String(n.id)); setSelectedEdgeId(null); }}
          onEdgeClick={(_, e) => { setSelectedEdgeId(String(e.id)); setSelectedNodeId(null); }}
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
