import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dagre from '@dagrejs/dagre';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile } from '../lib/upload';
import { apiJson } from '../lib/api';
import { friendlyEdgeLabel, edgeStroke } from './bpmnVisual';
import { ApprovalEntry, approvalEntriesToPatch, approvalEntryLabel, parseApprovalEntries } from '../lib/bpmnLint';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  Connection,
  Edge,
  MarkerType,
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
  const { onPaneCoord, onReady, children, ...rest } = props;
  const rf = useReactFlow();
  useEffect(() => {
    onReady?.(rf);
  }, [rf, onReady]);
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

const HANDLE_STYLE = { width: 12, height: 12, background: '#0F3D73', border: '2px solid #ffffff' } as const;

function LabeledNode({ data }: { data: any }) {
  const kind = data?.kind as string | undefined;
  const tt = String(data?.taskType || '').toUpperCase();
  const name = data?.label || data?.name || '';

  // 시작/종료: 원형
  if (kind === 'start' || kind === 'end') {
    const isStart = kind === 'start';
    return (
      <div style={{ width: 160, display: 'flex', justifyContent: 'center' }}>
        <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
        <div style={{
          width: 52, height: 52, borderRadius: 999,
          border: `2px solid ${isStart ? '#16a34a' : '#dc2626'}`,
          background: isStart ? '#ecfdf5' : '#fee2e2',
          color: isStart ? '#15803d' : '#b91c1c',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800,
        }}>{isStart ? '시작' : '종료'}</div>
        <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      </div>
    );
  }

  // 결재 + 분기 게이트웨이: 마름모꼴 (의사결정 지점)
  const isApproval = kind === 'task' && tt === 'APPROVAL';
  const isXor = kind === 'gateway_xor';
  const isParallel = kind === 'gateway_parallel';
  if (isApproval || isXor || isParallel) {
    const color = isApproval ? '#d97706' : isParallel ? '#0891b2' : '#7c3aed';
    const bg = isApproval ? '#fffbeb' : isParallel ? '#ecfeff' : '#f5f3ff';
    const badge = isApproval ? '결재' : isParallel ? '동시' : '분기';
    return (
      <div style={{ width: 160, display: 'grid', justifyItems: 'center', gap: 3 }}>
        <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
        <div style={{ width: 72, height: 72, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 9, transform: 'rotate(45deg)', background: bg, border: `2px solid ${color}`, borderRadius: 6 }} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color }}>{badge}</div>
        </div>
        {isApproval && name ? (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', textAlign: 'center', maxWidth: 150, lineHeight: 1.25 }}>{name}</div>
        ) : (!isApproval && name && name !== 'XOR' && name !== 'AND') ? (
          <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center', maxWidth: 150 }}>{name}</div>
        ) : null}
        <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
      </div>
    );
  }

  // 일반 업무 태스크: 둥근 사각형 + 유형 배지
  const badge = tt === 'COOPERATION' ? '🤝 업무요청' : tt === 'TASK' ? '☑️ 일반' : '📝 업무일지';
  return (
    <div style={{
      padding: '6px 8px 8px',
      border: '1.5px solid #94a3b8',
      borderRadius: 10,
      background: '#ffffff',
      minWidth: 160,
      textAlign: 'center',
      boxShadow: '0 1px 2px rgba(15,23,42,0.08)',
    }}>
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2 }}>{badge}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{name}</div>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </div>
  );
}


// 노드 종류별 대략적인 크기 (dagre 정렬용). 렌더된 실측값이 있으면 우선 사용.
function nodeBox(n: Node<any>): { w: number; h: number } {
  const w = (n as any).width || 180;
  const t = String(n.type || 'task');
  const fallbackH = t === 'start' || t === 'end' ? 60 : t.startsWith('gateway') ? 96 : 72;
  return { w, h: (n as any).height || fallbackH };
}

// dagre로 위→아래(TB) 자동 배치. 같은 계위(rank) 노드는 같은 높이에 정렬되고 화살표 교차가 최소화된다.
// 반려 루프백 엣지는 사이클을 만들어 레이아웃을 망가뜨리므로 계산에서 제외한다.
function layoutWithDagre(nodes: Node<any>[], edges: Edge<any>[]): Node<any>[] {
  if (!nodes.length) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 70, ranksep: 90, marginx: 24, marginy: 24, ranker: 'tight-tree' });
  nodes.forEach((n) => {
    const b = nodeBox(n);
    g.setNode(String(n.id), { width: b.w, height: b.h });
  });
  edges.forEach((e) => {
    if ((e as any).data?.isLoopBack) return;
    g.setEdge(String(e.source), String(e.target));
  });
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(String(n.id));
    if (!p) return n;
    const b = nodeBox(n);
    return {
      ...n,
      position: { x: Math.round(p.x - b.w / 2), y: Math.round(p.y - b.h / 2) },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });
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
  const rfRef = useRef<any>(null);
  const nodeCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const edgeCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const nodeTypes = useMemo(() => ({
    start: LabeledNode,
    end: LabeledNode,
    task: LabeledNode,
    gateway_parallel: LabeledNode,
    gateway_xor: LabeledNode,
  }), []);
  const defaultEdgeOptions = useMemo(() => ({ type: 'smoothstep' as const, markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 } }), []);
  const [panelOpen, setPanelOpen] = useState<boolean>(true);
  const [panelWidth, setPanelWidth] = useState<number>(380);
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
        assigneeType: (n.data && (n.data as any).assigneeType) || undefined,
        assigneeUserId: (n.data && (n.data as any).assigneeUserId) || undefined,
        assigneeOrgUnitId: (n.data && (n.data as any).assigneeOrgUnitId) || undefined,
        assigneeRoleCode: (n.data && (n.data as any).assigneeRoleCode) || undefined,
        emailToTemplate: (n.data && (n.data as any).emailToTemplate) || undefined,
        emailCcTemplate: (n.data && (n.data as any).emailCcTemplate) || undefined,
        emailSubjectTemplate: (n.data && (n.data as any).emailSubjectTemplate) || undefined,
        emailBodyTemplate: (n.data && (n.data as any).emailBodyTemplate) || undefined,
        stageLabel: (n.data && (n.data as any).stageLabel) || undefined,
        deadlineOffsetDays: (n.data && (n.data as any).deadlineOffsetDays) ?? undefined,
        slaHours: (n.data && (n.data as any).slaHours) ?? undefined,
        approvalUserIds: (n.data && (n.data as any).approvalUserIds) || undefined,
        approvalRoleCodes: (n.data && (n.data as any).approvalRoleCodes) || undefined,
        position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      })),
      edges: edges.map((e: Edge<any>) => ({ id: String(e.id), source: String(e.source), target: String(e.target), condition: (e as any).data?.condition, isLoopBack: (e as any).data?.isLoopBack || undefined })),
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
            assigneeType: n.assigneeType || undefined,
            assigneeUserId: n.assigneeUserId || undefined,
            assigneeOrgUnitId: n.assigneeOrgUnitId || undefined,
            assigneeRoleCode: n.assigneeRoleCode || undefined,
            emailToTemplate: n.emailToTemplate || undefined,
            emailCcTemplate: n.emailCcTemplate || undefined,
            emailSubjectTemplate: n.emailSubjectTemplate || undefined,
            emailBodyTemplate: n.emailBodyTemplate || undefined,
            stageLabel: n.stageLabel || undefined,
            deadlineOffsetDays: n.deadlineOffsetDays ?? undefined,
            slaHours: n.slaHours ?? undefined,
            approvalUserIds: n.approvalUserIds || undefined,
            approvalRoleCodes: n.approvalRoleCodes || undefined,
            label,
            kind: type,
          },
        } as Node<any>;
      });
      const ee: Edge<any>[] = (j.edges || []).map((e: any) => {
        const edgeData: any = {};
        if (e.condition) edgeData.condition = String(e.condition);
        if (e.isLoopBack) edgeData.isLoopBack = true;
        const cond = e.condition ? String(e.condition) : '';
        const stroke = edgeStroke(cond, !!e.isLoopBack);
        return {
          id: String(e.id || `${e.source}-${e.target}`),
          source: String(e.source),
          target: String(e.target),
          data: Object.keys(edgeData).length ? edgeData : undefined,
          label: friendlyEdgeLabel(cond, !!e.isLoopBack),
          labelStyle: stroke ? { fill: stroke, fontWeight: 700, fontSize: 11 } : { fontSize: 11 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
          style: e.isLoopBack
            ? { stroke: '#dc2626', strokeWidth: 2, strokeDasharray: '6 3' }
            : stroke ? { stroke, strokeWidth: 2 } : undefined,
          animated: !!e.isLoopBack,
        };
      });
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

  // 노드/엣지를 선택하면 세부 메뉴를 자동으로 열고 해당 카드로 스크롤
  useEffect(() => {
    if (selectedNodeId || selectedEdgeId) setPanelOpen(true);
  }, [selectedNodeId, selectedEdgeId]);

  useEffect(() => {
    const el = selectedNodeId ? nodeCardRefs.current[selectedNodeId] : (selectedEdgeId ? edgeCardRefs.current[selectedEdgeId] : null);
    if (el) {
      // 패널 슬라이드 애니메이션(0.25s)이 끝난 뒤 스크롤되도록 약간 지연
      const t = window.setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 280);
      return () => window.clearTimeout(t);
    }
  }, [selectedNodeId, selectedEdgeId]);

  // 오버레이 패널 왼쪽 가장자리를 드래그해서 폭 조절
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const minPanel = 300;
      const maxPanel = Math.max(minPanel, rect.width - 160); // 캔버스가 최소 160px는 보이도록
      const next = Math.max(minPanel, Math.min(rect.right - e.clientX, maxPanel));
      setPanelWidth(next);
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


  function removeNode(id: string) {
    setNodes((nds: Node<any>[]) => nds.filter((n) => String(n.id) !== id));
    setEdges((eds: Edge<any>[]) => eds.filter((e) => String(e.source) !== id && String(e.target) !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  }

  function removeEdge(id: string) {
    setEdges((eds: Edge<any>[]) => eds.filter((e) => String(e.id) !== id));
    if (selectedEdgeId === id) setSelectedEdgeId(null);
  }

  function autoLayout() {
    setNodes((nds: Node<any>[]) => {
      // 최신 노드 실측 크기를 반영하기 위해 ReactFlow 인스턴스의 노드를 우선 사용
      const live = rfRef.current?.getNodes?.() as Node<any>[] | undefined;
      const base = (live && live.length === nds.length) ? live : nds;
      return layoutWithDagre(base, edges);
    });
    // 배치가 적용된 다음 틱에 화면을 맞춤
    window.setTimeout(() => {
      try { rfRef.current?.fitView?.({ padding: 0.2, duration: 300 }); } catch {}
    }, 60);
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
        insertX = (prev[idx].position?.x ?? 180);
        insertY = (prev[idx].position?.y ?? 60) + 120;
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
        data: isTask ? { name: '새 과제', taskType: 'WORKLOG', label, kind: type } : { name: label, label, kind: type },
      };
      if (idx >= 0 && !lastPaneClick.current) {
        const before = prev.slice(0, idx + 1);
        const after = prev.slice(idx + 1).map((n) => ({
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

  const [orgOptions, setOrgOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [userOptions, setUserOptions] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);
  const [userQuery, setUserQuery] = useState('');
  useEffect(() => {
    apiJson<{ items: Array<{ id: string; name: string }> }>('/api/orgs')
      .then((r) => setOrgOptions(r.items || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      apiJson<{ items: Array<{ id: string; name: string; orgName?: string }> }>(`/api/orgs/members/all${userQuery.trim() ? `?q=${encodeURIComponent(userQuery.trim())}` : ''}`)
        .then((r) => setUserOptions(r.items || []))
        .catch(() => {});
    }, 250);
    return () => window.clearTimeout(t);
  }, [userQuery]);

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
      <div ref={(r) => (panelRef.current = r)} style={{ minWidth: 0, padding: 8, display: 'grid', gap: 8, alignContent: 'start', height: '100%', overflow: 'auto' }}>
        <div style={{ fontSize: 12, color: '#6b7280' }}>그래프에서 노드/엣지를 선택하면 여기 상세가 하이라이트되며 스크롤됩니다.</div>

        <h4>노드</h4>
        {nodes.length === 0 && <div style={{ fontSize: 12, color: '#6b7280' }}>노드를 추가하세요.</div>}
        {nodes.map((n: Node<any>) => (
          <div
            key={n.id}
            ref={(r) => { nodeCardRefs.current[String(n.id)] = r; }}
            style={{ border: '1px solid ' + (String(n.id) === selectedNodeId ? '#0F3D73' : '#e5e7eb'), boxShadow: String(n.id) === selectedNodeId ? '0 0 0 2px rgba(15,61,115,0.2)' : 'none', borderRadius: 6, padding: 8, background: String(n.id) === selectedNodeId ? '#F0F6FD' : '#fff' }}
          >
            {n.type === 'task' && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ flex: 1 }}>이름<input value={(n.data as any)?.name || ''} onChange={(e) => onNodeLabelChange(n.id, 'name', e.target.value)} /></label>
                  <button type="button" className="btn btn-ghost" onClick={() => removeNode(String(n.id))}>삭제</button>
                </div>
                <label>타입<select value={(n.data as any)?.taskType || 'WORKLOG'} onChange={(e) => onNodeLabelChange(n.id, 'taskType', e.target.value)}>
                  <option value="WORKLOG">업무일지</option>
                  <option value="COOPERATION">업무요청</option>
                  <option value="APPROVAL">결재</option>
                  <option value="TASK">일반</option>
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
                <label>담당 지정<select
                  value={(n.data as any)?.assigneeType || ''}
                  onChange={(e) => {
                    const v = e.target.value || undefined;
                    onNodeLabelChange(n.id, 'assigneeType', v);
                    onNodeLabelChange(n.id, 'assigneeUserId', undefined);
                    onNodeLabelChange(n.id, 'assigneeOrgUnitId', undefined);
                    onNodeLabelChange(n.id, 'assigneeRoleCode', undefined);
                  }}>
                  <option value="">미지정 (시작 시 수동 배정)</option>
                  <option value="ORG_UNIT">조직 (해당 조직 팀장에게 배정)</option>
                  <option value="USER">특정 사용자</option>
                </select></label>
                {(n.data as any)?.assigneeType === 'ORG_UNIT' && (
                  <label>담당 조직<select
                    value={(n.data as any)?.assigneeOrgUnitId || ''}
                    onChange={(e) => onNodeLabelChange(n.id, 'assigneeOrgUnitId', e.target.value || undefined)}>
                    <option value="">조직 선택...</option>
                    {(n.data as any)?.assigneeOrgUnitId && !orgOptions.some((o) => o.id === (n.data as any)?.assigneeOrgUnitId) && (
                      <option value={(n.data as any)?.assigneeOrgUnitId}>(현재 지정된 조직)</option>
                    )}
                    {orgOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select></label>
                )}
                {(n.data as any)?.assigneeType === 'USER' && (
                  <>
                    <label>사용자 검색<input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="이름으로 검색" /></label>
                    <label>담당 사용자<select
                      value={(n.data as any)?.assigneeUserId || ''}
                      onChange={(e) => onNodeLabelChange(n.id, 'assigneeUserId', e.target.value || undefined)}>
                      <option value="">사용자 선택...</option>
                      {(n.data as any)?.assigneeUserId && !userOptions.some((u) => u.id === (n.data as any)?.assigneeUserId) && (
                        <option value={(n.data as any)?.assigneeUserId}>(현재 지정된 사용자)</option>
                      )}
                      {userOptions.map((u) => <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` (${u.orgName})` : ''}</option>)}
                    </select></label>
                  </>
                )}
                <label>메일 To 템플릿<input value={(n.data as any)?.emailToTemplate || ''} onChange={(e) => onNodeLabelChange(n.id, 'emailToTemplate', e.target.value)} /></label>
                <label>메일 Cc 템플릿<input value={(n.data as any)?.emailCcTemplate || ''} onChange={(e) => onNodeLabelChange(n.id, 'emailCcTemplate', e.target.value)} /></label>
                <label>메일 제목 템플릿<input value={(n.data as any)?.emailSubjectTemplate || ''} onChange={(e) => onNodeLabelChange(n.id, 'emailSubjectTemplate', e.target.value)} /></label>
                <label>
                  메일 본문 템플릿
                  <textarea
                    value={(n.data as any)?.emailBodyTemplate || ''}
                    onChange={(e) => onNodeLabelChange(n.id, 'emailBodyTemplate', e.target.value)}
                    rows={6}
                  />
                </label>
                <label>스테이지<input value={(n.data as any)?.stageLabel || ''} onChange={(e) => onNodeLabelChange(n.id, 'stageLabel', e.target.value)} placeholder="예: 1. 기획" /></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label>마감 D+일<input type="number" min={0} value={(n.data as any)?.deadlineOffsetDays ?? ''} onChange={(e) => onNodeLabelChange(n.id, 'deadlineOffsetDays', e.target.value ? Number(e.target.value) : undefined)} placeholder="예: 7" /></label>
                  <label>SLA(시간)<input type="number" min={0} value={(n.data as any)?.slaHours ?? ''} onChange={(e) => onNodeLabelChange(n.id, 'slaHours', e.target.value ? Number(e.target.value) : undefined)} placeholder="예: 48" /></label>
                </div>
                {String((n.data as any)?.taskType || '').toUpperCase() === 'APPROVAL' && (() => {
                  // 결재선 = 사람 + 역할(팀장/임원) 혼합 순서. 역할은 프로세스 시작 시 사람으로 확정된다.
                  const entries = parseApprovalEntries(n.data);
                  const nameOf = (uid: string) => {
                    const u = userOptions.find((x) => x.id === uid);
                    return u ? `${u.name}${u.orgName ? ` (${u.orgName})` : ''}` : uid;
                  };
                  const orgNameOf = (oid: string) => orgOptions.find((o) => o.id === oid)?.name || '(조직)';
                  const setEntries = (next: ApprovalEntry[]) => {
                    const patch = approvalEntriesToPatch(next);
                    onNodeLabelChange(n.id, 'approvalUserIds', patch.approvalUserIds);
                    onNodeLabelChange(n.id, 'approvalRoleCodes', patch.approvalRoleCodes);
                  };
                  const addRoleCode = (code: string) => {
                    if (!code) return;
                    const e: ApprovalEntry = code === 'MGR:STARTER' ? { kind: 'MGR', orgUnitId: 'STARTER' }
                      : code.startsWith('MGR:') ? { kind: 'MGR', orgUnitId: code.slice(4) }
                      : code.startsWith('EXEC:') ? { kind: 'EXEC', orgUnitId: code.slice(5) }
                      : { kind: 'EXEC' };
                    setEntries([...entries, e]);
                  };
                  return (
                    <div style={{ border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 8, padding: 8, display: 'grid', gap: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>결재선 (순서대로 결재)</div>
                      {entries.length === 0 && <div style={{ fontSize: 11, color: '#b45309' }}>결재자(사람) 또는 역할(팀장/임원)을 순서대로 추가하세요. 역할은 프로세스 시작 시 사람으로 자동 확정됩니다.</div>}
                      {entries.map((en, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                          <span style={{ width: 18, height: 18, borderRadius: 999, background: en.kind === 'USER' ? '#d97706' : '#7c3aed', color: '#fff', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{idx + 1}</span>
                          <span style={{ flex: 1 }}>
                            {approvalEntryLabel(en, orgNameOf, nameOf)}
                            {en.kind !== 'USER' && <span style={{ marginLeft: 4, fontSize: 10, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 4, padding: '0 4px' }}>역할</span>}
                          </span>
                          <button type="button" className="btn btn-ghost" style={{ padding: '0 6px' }} disabled={idx === 0}
                            onClick={() => { const nx = [...entries]; [nx[idx - 1], nx[idx]] = [nx[idx], nx[idx - 1]]; setEntries(nx); }}>↑</button>
                          <button type="button" className="btn btn-ghost" style={{ padding: '0 6px' }}
                            onClick={() => setEntries(entries.filter((_, i) => i !== idx))}>×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <input style={{ flex: 1, minWidth: 100 }} placeholder="이름 검색" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} />
                        <select value="" onChange={(e) => { const v = e.target.value; if (v) setEntries([...entries, { kind: 'USER', userId: v }]); }}>
                          <option value="">결재자(사람) 추가...</option>
                          {userOptions.filter((u) => !entries.some((en) => en.kind === 'USER' && en.userId === u.id)).map((u) => (
                            <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` (${u.orgName})` : ''}</option>
                          ))}
                        </select>
                        <select value="" onChange={(e) => addRoleCode(e.target.value)}>
                          <option value="">역할 추가...</option>
                          <option value="MGR:STARTER">시작자 팀 팀장</option>
                          <option value="EXEC">임원 (시작 시 확정)</option>
                          <optgroup label="특정 팀 팀장">
                            {orgOptions.map((o) => <option key={`m-${o.id}`} value={`MGR:${o.id}`}>{o.name} 팀장</option>)}
                          </optgroup>
                          <optgroup label="특정 팀 임원">
                            {orgOptions.map((o) => <option key={`e-${o.id}`} value={`EXEC:${o.id}`}>{o.name} 임원</option>)}
                          </optgroup>
                        </select>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
            {(n.type === 'gateway_parallel' || n.type === 'gateway_xor') && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ flex: 1 }}>제목<input value={(n.data as any)?.name || ''} onChange={(e) => onNodeLabelChange(n.id, 'name', e.target.value)} /></label>
                  <button type="button" className="btn btn-ghost" onClick={() => removeNode(String(n.id))}>삭제</button>
                </div>
              </>
            )}
            {n.type !== 'task' && n.type !== 'gateway_parallel' && n.type !== 'gateway_xor' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{n.type === 'start' ? '시작' : n.type === 'end' ? '종료' : String(n.type)}</span>
                <button type="button" className="btn btn-ghost" onClick={() => removeNode(String(n.id))}>삭제</button>
              </div>
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
              <span style={{ fontWeight: 600, flex: 1 }}>연결: {(() => { const sn = nodes.find((x: any) => String(x.id) === String(e.source)); const tn = nodes.find((x: any) => String(x.id) === String(e.target)); return `${(sn?.data as any)?.name || (sn?.type === 'start' ? '시작' : sn?.type === 'end' ? '종료' : sn?.type) || e.source} → ${(tn?.data as any)?.name || (tn?.type === 'start' ? '시작' : tn?.type === 'end' ? '종료' : tn?.type) || e.target}`; })()}</span>
              <button type="button" className="btn btn-ghost" onClick={() => removeEdge(String(e.id))}>삭제</button>
            </div>
            <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(1, minmax(0, 1fr))', gap: 8 }}>
              <label>
                조건(XOR)
                <input
                  value={((e as any).data?.condition || '')}
                  placeholder="예: last.approval.status == 'APPROVED'"
                  onChange={(ev) => {
                    const val = ev.target.value;
                    setEdges((prev: Edge<any>[]) => prev.map((x) => (String(x.id) === String(e.id) ? { ...x, data: { ...(x as any).data, condition: val }, label: friendlyEdgeLabel(val, !!(x as any).data?.isLoopBack) } : x)));
                  }}
                />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      const val = "last.approval.status == 'APPROVED'";
                      setEdges((prev: Edge<any>[]) => prev.map((x) => (String(x.id) === String(e.id) ? { ...x, data: { ...(x as any).data, condition: val }, label: friendlyEdgeLabel(val, !!(x as any).data?.isLoopBack) } : x)));
                    }}
                  >승인</button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      const val = "last.approval.status == 'REJECTED'";
                      setEdges((prev: Edge<any>[]) => prev.map((x) => (String(x.id) === String(e.id) ? { ...x, data: { ...(x as any).data, condition: val }, label: friendlyEdgeLabel(val, !!(x as any).data?.isLoopBack) } : x)));
                    }}
                  >반려</button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      const val = '';
                      setEdges((prev: Edge<any>[]) => prev.map((x) => (String(x.id) === String(e.id) ? { ...x, data: { ...(x as any).data, condition: val }, label: friendlyEdgeLabel(val, !!(x as any).data?.isLoopBack) } : x)));
                    }}
                  >비우기</button>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>사용 가능 변수: last.approval.status</div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!(e as any).data?.isLoopBack}
                  onChange={(ev) => {
                    const checked = ev.target.checked;
                    setEdges((prev: Edge<any>[]) => prev.map((x) => {
                      if (String(x.id) !== String(e.id)) return x;
                      const newData = { ...(x as any).data, isLoopBack: checked || undefined };
                      const labelParts: string[] = [];
                      if (newData.condition) labelParts.push(newData.condition);
                      if (checked) labelParts.push('[LoopBack]');
                      return {
                        ...x,
                        data: newData,
                        label: labelParts.length ? labelParts.join(' ') : undefined,
                        style: checked ? { stroke: '#f97316', strokeWidth: 2, strokeDasharray: '6 3' } : undefined,
                        animated: checked,
                      };
                    }));
                  }}
                />
                <span style={{ fontWeight: 500, color: '#f97316' }}>반려 루프백</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>(결재 반려 시 이전 태스크로 되돌림)</span>
              </label>
            </div>
          </div>
        ))}
      </div>
    );
  }, [nodes, toJson, fromJson, jsonText, edges, selectedNodeId, selectedEdgeId, orgOptions, userOptions, userQuery]);

  return (
    <div ref={containerRef} style={{ position: 'relative', border: '1px solid #e5e7eb', borderRadius: 8, height: height ?? 480, overflow: 'hidden' }}>
      {/* 캔버스: 항상 컨테이너 전체 폭 사용 (세부 메뉴는 위에 슬라이딩으로 겹쳐짐) */}
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%', width: '100%' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn" onClick={() => addNode('start')}>Start</button>
            <button type="button" className="btn" onClick={() => addNode('task')}>Task</button>
            <button type="button" className="btn" onClick={() => addNode('gateway_parallel')}>AND</button>
            <button type="button" className="btn" onClick={() => addNode('gateway_xor')}>XOR</button>
            <button type="button" className="btn" onClick={() => addNode('end')}>End</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-primary" onClick={autoLayout} title="연결 흐름에 따라 자동 정렬 (같은 계위는 같은 높이)">자동 배치</button>
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
              onNodeClick={(_: any, n: any) => { lastPaneClick.current = null; setSelectedNodeId(String(n.id)); setSelectedEdgeId(null); }}
              onEdgeClick={(_: any, e: any) => { lastPaneClick.current = null; setSelectedEdgeId(String(e.id)); setSelectedNodeId(null); }}
              onNodeDragStop={() => { toJson(); }}
              nodesDraggable={true}
              nodesConnectable={true}
              elementsSelectable={true}
              connectOnClick={true}
              deleteKeyCode={null}
              fitView
              style={{ width: '100%', height: '100%' }}
              onPaneCoord={(p: { x: number; y: number }) => { lastPaneClick.current = p; }}
              onReady={(rf: any) => { rfRef.current = rf; }}
            >
              <Background />
              <MiniMap />
              <Controls />
            </InnerFlow>
          </ReactFlowProvider>
        </div>
      </div>
      {/* 세부 메뉴 열기/닫기 토글 탭 (오른쪽 가장자리에 항상 표시) */}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        title={panelOpen ? '세부 메뉴 닫기' : '세부 메뉴 열기'}
        aria-label={panelOpen ? '세부 메뉴 닫기' : '세부 메뉴 열기'}
        style={{
          position: 'absolute',
          top: 12,
          right: panelOpen ? panelWidth : 0,
          transition: resizing ? 'none' : 'right 0.25s ease',
          zIndex: 6,
          width: 26,
          height: 64,
          border: '1px solid #e5e7eb',
          borderRight: 'none',
          borderRadius: '8px 0 0 8px',
          background: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          color: '#374151',
          boxShadow: '-2px 0 8px rgba(0,0,0,0.06)',
        }}
      >
        {panelOpen ? '▶' : '◀'}
      </button>

      {/* 세부 메뉴: 슬라이딩 오버레이 패널 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: panelWidth,
          maxWidth: '90%',
          transform: panelOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: resizing ? 'none' : 'transform 0.25s ease',
          background: '#fff',
          borderLeft: '1px solid #e5e7eb',
          boxShadow: panelOpen ? '-8px 0 24px rgba(15,23,42,0.10)' : 'none',
          zIndex: 5,
          display: 'flex',
        }}
      >
        {/* 폭 조절 핸들 (패널 왼쪽 가장자리 드래그) */}
        <div
          onMouseDown={() => setResizing(true)}
          title="드래그하여 폭 조절"
          style={{ flex: '0 0 auto', width: 6, cursor: 'col-resize', background: 'transparent' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {sidePanel}
        </div>
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
  const [attachOneDriveOk, setAttachOneDriveOk] = useState<boolean>(false);

  // init once
  useEffect(() => {
    if (!elRef.current || qref.current) return;
    const toolbar = [
      [{ header: [1, 2, 3, false] }],
      [{ font: [] }],
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
    const ctr = ((q as any).container || q.root.parentElement) as HTMLElement | null;
    if (ctr) {
      ctr.addEventListener('paste', onPaste as any, true);
      ctr.addEventListener('drop', onDrop as any, true);
      ctr.addEventListener('dragover', onDragOver as any, true);
    }
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
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              if (!attachOneDriveOk) {
                const ok = window.confirm('원드라이브(회사)에서 받은 파일만 업로드하세요. 계속할까요?');
                if (!ok) return;
                setAttachOneDriveOk(true);
              }
              attachInputRef.current?.click();
            }}
          >파일 선택</button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => window.open('https://office.com/launch/onedrive', '_blank', 'noopener,noreferrer')}
          >OneDrive 열기</button>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
          <input type="checkbox" checked={attachOneDriveOk} onChange={(e) => setAttachOneDriveOk(e.target.checked)} />
          원드라이브 파일만 업로드합니다
        </label>
        <div style={{ fontSize: 12, color: '#64748b' }}>원드라이브 파일만 올려주세요. 업로드하면 본문에 링크로 삽입됩니다.</div>
        <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: 12 }}>#{nodeId}</span>
      </div>
    </div>
  );
}
