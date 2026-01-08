import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile } from '../lib/upload';
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
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';

function InnerFlow(props: any) {
  const { onPaneCoord, children, ...rest } = props;
  const rf = useReactFlow();
  return (
    <ReactFlow
      {...rest}
      onPaneClick={(e: any) => {
        const conv = (rf as any).screenToFlowPosition || (rf as any).project;
        if (conv) {
          const p = conv({ x: e.clientX, y: e.clientY });
          onPaneCoord?.(p);
        }
      }}
    >
      {children}
    </ReactFlow>
  );
}

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
      <Handle type="target" position={Position.Top} style={{ width: 12, height: 12, background: '#0F3D73', border: '2px solid #ffffff' }} />
      <div>{data?.label || data?.name || ''}</div>
      <Handle type="source" position={Position.Bottom} style={{ width: 12, height: 12, background: '#0F3D73', border: '2px solid #ffffff' }} />
    </div>
  );
}

export function BpmnEditor({ jsonText, onChangeJson, height }: { jsonText: string; onChangeJson: (t: string) => void; height?: number | string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<any>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<any>>([]);
  const idCounter = useRef(1);
  const importingRef = useRef(false);
  const lastEmittedJsonTextRef = useRef<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
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
  const [graphWidth, setGraphWidth] = useState<number>(520);
  const [resizing, setResizing] = useState<boolean>(false);
  const lastPaneClick = useRef<{ x: number; y: number } | null>(null);
  const syncTimerRef = useRef<number | null>(null);

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
        position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      })),
      edges: edges.map((e: Edge<any>) => ({ id: String(e.id), source: String(e.source), target: String(e.target), condition: (e as any).data?.condition })),
    };
    const txt = JSON.stringify(j, null, 2);
    lastEmittedJsonTextRef.current = txt;
    onChangeJson(txt);
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
        const hasPos = n && n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number';
        const px = hasPos ? n.position.x : 180;
        const py = hasPos ? n.position.y : 60 + idx * 120;
        return {
          id: String(n.id),
          type,
          position: { x: px, y: py },
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
    if (jsonText) {
      importingRef.current = true;
      fromJson(jsonText);
    }
  }, []); // init only

  // Auto-sync: whenever graph changes, reflect to parent JSON
  useEffect(() => {
    if (syncTimerRef.current) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (importingRef.current) {
      importingRef.current = false;
      return;
    }
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      toJson();
    }, 150);
    return () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [nodes, edges, toJson]);

  // When parent JSON changes (e.g., auto-linearize), import into editor without causing emit loop
  useEffect(() => {
    if (!jsonText) return;
    if (jsonText === lastEmittedJsonTextRef.current) return;
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
    function onMove(e: MouseEvent) {
      if (!resizing || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const minGraph = 260;
      const minPanel = 300;
      const offsetX = e.clientX - rect.left; // graph area width
      const next = Math.max(minGraph, Math.min(offsetX, rect.width - minPanel));
      setGraphWidth(next);
      e.preventDefault();
    }
    function onUp() {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    if (resizing) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizing]);

  // Clamp widths on container resize so the detail panel is never clipped
  useEffect(() => {
    const el = containerRef.current as HTMLElement | null;
    if (!el || !(window as any).ResizeObserver) return;
    const ro = new (window as any).ResizeObserver((entries: any[]) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      const minGraph = 260;
      const minPanel = 300;
      setGraphWidth((prev) => Math.max(minGraph, Math.min(prev, cr.width - minPanel)));
    });
    ro.observe(el);
    return () => { try { ro.disconnect(); } catch {} };
  }, []);

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

  function autoLinearize() {
    setEdges((prev) => {
      const now = Date.now();
      const start = nodes.find((n) => n.type === 'start');
      const end = nodes.find((n) => n.type === 'end');
      const tasks = nodes
        .filter((n) => n.type === 'task')
        .slice()
        .sort((a, b) => (a.position?.y || 0) - (b.position?.y || 0));
      if (prev.length && !confirm(`기존 엣지 ${prev.length}개를 모두 삭제하고 순차 연결로 대체할까요?`)) return prev;
      const next: Edge<any>[] = [];
      if (start && tasks[0]) next.push({ id: `e${now}_s`, source: String(start.id), target: String(tasks[0].id) });
      for (let i = 0; i < tasks.length - 1; i++) {
        next.push({ id: `e${now}_${i}`, source: String(tasks[i].id), target: String(tasks[i + 1].id) });
      }
      if (end && tasks.length) next.push({ id: `e${now}_e`, source: String(tasks[tasks.length - 1].id), target: String(end.id) });
      if (!tasks.length && start && end) next.push({ id: `e${now}_se`, source: String(start.id), target: String(end.id) });
      return next;
    });
  }

  const addNode = (type: string) => {
    const id = `n${Date.now()}_${idCounter.current++}`;
    const label = type === 'start' ? 'Start' : type === 'end' ? 'End' : type.startsWith('gateway') ? (type === 'gateway_parallel' ? 'AND' : 'XOR') : '새 과제';
    const isTask = type === 'task';
    const selNodeId = selectedNodeId;

    // 2) Otherwise, insert at last pane click position if available; else fallback to previous logic
    setNodes((prev: Node<any>[]) => {
      const idx = selNodeId ? prev.findIndex((n) => String(n.id) === String(selNodeId)) : -1;
      let insertX = 180;
      let insertY = 60;
      if (lastPaneClick.current) {
        insertX = Math.round(lastPaneClick.current.x);
        insertY = Math.round(lastPaneClick.current.y);
      } else if (idx >= 0) {
        insertY = (prev[idx].position?.y || 60);
      } else if (prev.length) {
        insertY = Math.max(...prev.map((n) => n.position.y || 0)) + 120;
      }
      const newNode: Node<any> = {
        id,
        type,
        position: { x: insertX, y: insertY },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        style: { width: 180 },
        data: isTask ? { name: '새 과제', taskType: 'TASK', label, kind: type } : { name: label, label, kind: type },
      };
      if (idx >= 0 && !lastPaneClick.current) {
        const before = prev.slice(0, idx);
        const after = prev.slice(idx).map((n) => ({
          ...n,
          position: { x: (n.position?.x ?? 180), y: (n.position?.y || 0) + 120 },
        }));
        return [...before, newNode, ...after];
      }
      return [...prev, newNode];
    });
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
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
      <div ref={(r) => (panelRef.current = r)} style={{ minWidth: 300, borderLeft: '1px solid #e5e7eb', padding: 8, display: 'grid', gap: 8, maxHeight: height ?? 480, overflow: 'auto' }}>
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
                <div>
                  <label>설명</label>
                  <NodeDescEditor
                    nodeId={String(n.id)}
                    initialHtml={(n.data as any)?.description || ''}
                    onChangeHtml={(html) => onNodeLabelChange(n.id, 'description', html)}
                  />
                </div>
                <label>담당자 힌트<input value={(n.data as any)?.assigneeHint || ''} onChange={(e) => onNodeLabelChange(n.id, 'assigneeHint', e.target.value)} /></label>
                {false && (<label>스테이지<input value={(n.data as any)?.stageLabel || ''} onChange={(e) => onNodeLabelChange(n.id, 'stageLabel', e.target.value)} /></label>)}
                {false && (<label>마감 오프셋(D+)<input type="number" value={(n.data as any)?.deadlineOffsetDays ?? ''} onChange={(e) => onNodeLabelChange(n.id, 'deadlineOffsetDays', e.target.value ? Number(e.target.value) : undefined)} /></label>)}
                {false && (
                  <label>담당자 순번(쉼표로 ID 나열)
                    <input
                      placeholder="userA,userB,userC"
                      value={(n.data as any)?.approvalUserIds || ''}
                      onChange={(e) => onNodeLabelChange(n.id, 'approvalUserIds', e.target.value)}
                    />
                  </label>
                )}
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
    <div ref={containerRef} style={{ display: 'grid', gridTemplateColumns: `${graphWidth}px 6px minmax(320px, 1fr)`, gap: 8, border: '1px solid #e5e7eb', borderRadius: 8, height: height ?? 480, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%', minWidth: 0 }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn" onClick={() => addNode('start')}>Start</button>
            <button type="button" className="btn" onClick={() => addNode('task')}>Task</button>
            <button type="button" className="btn" onClick={() => addNode('gateway_parallel')}>AND</button>
            <button type="button" className="btn" onClick={() => addNode('gateway_xor')}>XOR</button>
            <button type="button" className="btn" onClick={() => addNode('end')}>End</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn" onClick={() => setNodes((nds: Node<any>[]) => nds.map((n: Node<any>, idx: number) => ({ ...n, position: { x: 180, y: 60 + idx * 120 } })))}>세로 정렬</button>
            <button type="button" className="btn btn-outline" onClick={autoLinearize}>선형 연결 자동생성</button>
          </div>
        </div>
        <div style={{ height: '100%', minWidth: 0 }}>
          <ReactFlowProvider>
            <InnerFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange as any}
              onNodeClick={(_: any, n: any) => { setSelectedNodeId(String(n.id)); setSelectedEdgeId(null); }}
              onEdgeClick={(_: any, e: any) => { setSelectedEdgeId(String(e.id)); setSelectedNodeId(null); }}
              onNodeDragStop={() => { toJson(); }}
              nodesDraggable={true}
              nodesConnectable={true}
              elementsSelectable={true}
              connectOnClick={true}
              fitView
              style={{ width: '100%', height: '100%' }}
              onPaneCoord={(p: { x: number; y: number }) => { lastPaneClick.current = p; }}
            >
              <Background />
              <MiniMap />
              <Controls />
            </InnerFlow>
          </ReactFlowProvider>
        </div>
      </div>
      <div
        onMouseDown={() => {
          setResizing(true);
        }}
        style={{ cursor: 'col-resize', width: 6, background: 'transparent' }}
      />
      <div style={{ minWidth: 0 }}>
        {sidePanel}
      </div>
    </div>
  );
}

function NodeDescEditor(props: { nodeId: string; initialHtml: string; onChangeHtml: (html: string) => void }) {
  const { nodeId, initialHtml, onChangeHtml } = props;
  const elRef = useRef<HTMLDivElement | null>(null);
  const qref = useRef<Quill | null>(null);
  const [html, setHtml] = useState<string>(initialHtml || '');
  const lastHtmlRef = useRef<string>(initialHtml || '');
  const applyingRef = useRef<boolean>(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  // init once
  useEffect(() => {
    if (!elRef.current || qref.current) return;
    const toolbar = [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'image'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      ['clean'],
    ];
    const q = new Quill(elRef.current, {
      theme: 'snow',
      modules: {
        toolbar: {
          container: toolbar,
          handlers: {
            image: async function () {
              try {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = async () => {
                  try {
                    const file = input.files?.[0];
                    if (!file) return;
                    const up = await uploadFile(file);
                    const range = (q as any).getSelection?.(true);
                    if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
                    else (q as any).insertEmbed(0, 'image', up.url, 'user');
                  } catch {
                    alert('이미지 업로드에 실패했습니다. 파일 크기/형식을 확인하고 다시 시도하세요.');
                  }
                };
                input.click();
              } catch {}
            },
          },
        },
      },
      placeholder: '노드 설명을 입력하세요.',
    } as any);
    q.on('text-change', () => {
      if (applyingRef.current) return;
      const next = q.root.innerHTML;
      lastHtmlRef.current = next;
      setHtml(next);
    });
    // paste & drop: allow image uploads (with compression). Convert data URIs by uploading.
    const onPaste = async (e: ClipboardEvent) => {
      try {
        const items = e.clipboardData?.items;
        const html = e.clipboardData?.getData('text/html') || '';
        if (items) {
          const imgs = Array.from(items).filter((i) => i.type.startsWith('image/'));
          if (imgs.length) {
            e.preventDefault();
            e.stopPropagation();
            for (const it of imgs) {
              const file = it.getAsFile();
              if (!file) continue;
              const up = await uploadFile(file);
              const range = (q as any).getSelection?.(true);
              if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
              else (q as any).insertEmbed(0, 'image', up.url, 'user');
            }
            return;
          }
        }
        if (html && (html.includes('src="data:') || html.includes("src='data:"))) {
          e.preventDefault();
          e.stopPropagation();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const imgsEl = Array.from(doc.images || []).filter((im) => im.src.startsWith('data:'));
          for (const im of imgsEl) {
            try {
              const res = await fetch(im.src);
              const blob = await res.blob();
              const f = new File([blob], 'pasted.' + (blob.type.includes('png') ? 'png' : 'jpg'), { type: blob.type });
              const up = await uploadFile(f);
              im.src = up.url;
            } catch {
              im.remove();
            }
          }
          const range = (q as any).getSelection?.(true);
          const sane = doc.body.innerHTML;
          if (range) (q as any).clipboard.dangerouslyPasteHTML(range.index, sane, 'user');
          else (q as any).clipboard.dangerouslyPasteHTML(0, sane, 'user');
        }
      } catch {}
    };
    const onDrop = async (e: DragEvent) => {
      try {
        const html = (e.dataTransfer && (e.dataTransfer.getData && e.dataTransfer.getData('text/html'))) || '';
        const files = e.dataTransfer?.files;
        const imgs = files ? Array.from(files).filter((f) => f.type.startsWith('image/')) : [];
        if (imgs.length) {
          e.preventDefault();
          e.stopPropagation();
          for (const f of imgs) {
            const up = await uploadFile(f);
            const range = (q as any).getSelection?.(true);
            if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
            else (q as any).insertEmbed(0, 'image', up.url, 'user');
          }
          return;
        }
        if (html && (html.includes('src="data:') || html.includes("src='data:"))) {
          e.preventDefault();
          e.stopPropagation();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const imgsEl = Array.from(doc.images || []).filter((im) => im.src.startsWith('data:'));
          for (const im of imgsEl) {
            try {
              const res = await fetch(im.src);
              const blob = await res.blob();
              const f = new File([blob], 'drop.' + (blob.type.includes('png') ? 'png' : 'jpg'), { type: blob.type });
              const up = await uploadFile(f);
              im.src = up.url;
            } catch {
              im.remove();
            }
          }
          const range = (q as any).getSelection?.(true);
          const sane = doc.body.innerHTML;
          if (range) (q as any).clipboard.dangerouslyPasteHTML(range.index, sane, 'user');
          else (q as any).clipboard.dangerouslyPasteHTML(0, sane, 'user');
        }
      } catch {}
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    (q.root as HTMLElement)?.addEventListener('paste', onPaste as any);
    (q.root as HTMLElement)?.addEventListener('drop', onDrop as any);
    (q.root as HTMLElement)?.addEventListener('dragover', onDragOver as any);
    (async () => {
      try {
        applyingRef.current = true;
        // Sanitize existing data URIs in initial HTML: upload and replace
        let content = initialHtml || '';
        if (content.includes('src="data:') || content.includes("src='data:")) {
          const doc = new DOMParser().parseFromString(content, 'text/html');
          const imgsEl = Array.from(doc.images || []).filter((im) => im.src.startsWith('data:'));
          for (const im of imgsEl) {
            try {
              const res = await fetch(im.src);
              const blob = await res.blob();
              const f = new File([blob], 'init.' + (blob.type.includes('png') ? 'png' : 'jpg'), { type: blob.type });
              const up = await uploadFile(f);
              im.src = up.url;
            } catch {
              im.remove();
            }
          }
          content = doc.body.innerHTML;
        }
        q.setContents(q.clipboard.convert(content));
        lastHtmlRef.current = q.root.innerHTML;
        setHtml(lastHtmlRef.current);
      } finally {
        applyingRef.current = false;
      }
    })();
    qref.current = q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // propagate changes upward
  useEffect(() => {
    onChangeHtml(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  // apply external prop changes without duplicating
  useEffect(() => {
    const q = qref.current;
    if (!q) return;
    if ((initialHtml || '') === (lastHtmlRef.current || '')) return;
    try {
      applyingRef.current = true;
      q.setContents(q.clipboard.convert(initialHtml || ''));
      lastHtmlRef.current = q.root.innerHTML;
      setHtml(lastHtmlRef.current);
    } finally {
      applyingRef.current = false;
    }
  }, [initialHtml]);

  async function addAttachmentFiles(list: FileList | null) {
    const q = qref.current as any;
    if (!q) return;
    const files = Array.from(list || []);
    if (!files.length) return;
    for (const f of files) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const up = await uploadFile(f);
        const label = up.name || f.name;
        const linkHtml = `<a href="${up.url}" target="_blank" rel="noreferrer">${label}</a>`;
        const range = q?.getSelection?.(true);
        if (range) q.clipboard.dangerouslyPasteHTML(range.index, linkHtml);
        else q.clipboard.dangerouslyPasteHTML(0, linkHtml);
      } catch {
        alert('첨부 파일 업로드에 실패했습니다. 다시 시도하세요.');
      }
    }
  }

  return (
    <div>
      <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
        <div ref={(r) => (elRef.current = r)} style={{ minHeight: 120, width: '100%' }} />
      </div>
      <div style={{ marginTop: 6 }}>
        <label>첨부 파일</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              addAttachmentFiles(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
          <button type="button" className="btn btn-sm" onClick={() => attachInputRef.current?.click()}>파일 선택</button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => window.open('https://office.com/launch/onedrive', '_blank', 'noopener,noreferrer')}
          >OneDrive 열기</button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b' }}>원드라이브 파일만 올려주세요. 업로드하면 본문에 링크로 삽입됩니다.</div>
        <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: 12 }}>#{nodeId}</span>
      </div>
    </div>
  );
}
