import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFiles, uploadFile } from '../lib/upload';

type BpmnNode = {
  id: string;
  type: 'start' | 'task' | 'gateway_parallel' | 'gateway_xor' | 'end';
  name?: string;
  taskType?: 'TASK' | 'WORKLOG' | 'COOPERATION' | 'APPROVAL';
  description?: string;
  assigneeHint?: string;
  stageLabel?: string;
  deadlineOffsetDays?: number;
  position?: { x: number; y: number };
};

type BpmnEdge = {
  id: string;
  source: string;
  target: string;
  condition?: string; // for XOR conditions (optional)
};

export function BpmnFormEditor({ jsonText, onChangeJson }: { jsonText: string; onChangeJson: (t: string) => void }) {
  const [nodes, setNodes] = useState<BpmnNode[]>([]);
  const [edges, setEdges] = useState<BpmnEdge[]>([]);
  const [newNodeType, setNewNodeType] = useState<BpmnNode['type']>('task');
  const [error, setError] = useState<string>('');
  const idSeq = useRef<number>(1);
  const importingRef = useRef<boolean>(false);

  const parseJson = useCallback((txt: string) => {
    try {
      const j = JSON.parse(txt || '{}');
      const nn: BpmnNode[] = Array.isArray(j?.nodes) ? j.nodes.map((n: any) => ({
        id: String(n.id),
        type: (n.type || 'task') as any,
        name: n.name || '',
        taskType: n.taskType || undefined,
        description: n.description || n.descriptionHtml || undefined,
        assigneeHint: n.assigneeHint || undefined,
        stageLabel: n.stageLabel || undefined,
        deadlineOffsetDays: typeof n.deadlineOffsetDays === 'number' ? n.deadlineOffsetDays : undefined,
        position: (n && n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number') ? { x: n.position.x, y: n.position.y } : undefined,
      })) : [];
      const ee: BpmnEdge[] = Array.isArray(j?.edges) ? j.edges.map((e: any, idx: number) => ({
        id: String(e.id || `e${idx}`),
        source: String(e.source),
        target: String(e.target),
        condition: e.condition ? String(e.condition) : undefined,
      })) : [];
      setNodes(nn);
      setEdges(ee);
      setError('');
    } catch (e: any) {
      setError('JSON 파싱에 실패했습니다.');
    }
  }, []);

  useEffect(() => {
    if (jsonText) parseJson(jsonText);
  }, []);

  // Auto-sync: whenever nodes/edges change, emit JSON to parent so Save uses latest BPMN
  useEffect(() => {
    if (importingRef.current) { importingRef.current = false; return; }
    emitJson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // When parent JSON changes (e.g., auto-linearize), import into editor
  useEffect(() => {
    if (!jsonText) return;
    importingRef.current = true;
    parseJson(jsonText);
  }, [jsonText, parseJson]);

  const emitJson = useCallback(() => {
    const j = {
      nodes: nodes,
      edges: edges,
    };
    onChangeJson(JSON.stringify(j, null, 2));
  }, [nodes, edges, onChangeJson]);

  const addNode = () => {
    const id = `n${Date.now()}_${idSeq.current++}`;
    const base: BpmnNode = { id, type: newNodeType };
    if (newNodeType === 'task') {
      base.name = '새 과제';
      base.taskType = 'TASK';
    } else if (newNodeType === 'start') {
      base.name = 'Start';
    } else if (newNodeType === 'end') {
      base.name = 'End';
    } else if (newNodeType === 'gateway_parallel') {
      base.name = 'AND';
    } else if (newNodeType === 'gateway_xor') {
      base.name = 'XOR';
    }
    setNodes((prev) => prev.concat(base));
  };

  const updateNode = (id: string, patch: Partial<BpmnNode>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  };

  const removeNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id));
  };

  const addEdge = () => {
    const candidates = nodes.map((n) => n.id);
    if (candidates.length < 2) {
      alert('엣지를 추가하려면 최소 2개의 노드가 필요합니다.');
      return;
    }
    const source = candidates[0];
    const target = candidates.find((x) => x !== source) || candidates[0];
    const id = `e${Date.now()}_${idSeq.current++}`;
    setEdges((prev) => prev.concat({ id, source, target }));
  };

  const updateEdge = (id: string, patch: Partial<BpmnEdge>) => {
    setEdges((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const removeEdge = (id: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== id));
  };

  const autoLinearize = () => {
    const now = Date.now();
    const start = nodes.find((n) => n.type === 'start');
    const end = nodes.find((n) => n.type === 'end');
    const tasks = nodes.filter((n) => n.type === 'task');
    if (edges.length && !confirm(`기존 엣지 ${edges.length}개를 모두 삭제하고 순차 연결로 대체할까요?`)) return;
    const next: BpmnEdge[] = [];
    if (start && tasks[0]) next.push({ id: `e${now}_s`, source: start.id, target: tasks[0].id });
    for (let i = 0; i < tasks.length - 1; i++) {
      next.push({ id: `e${now}_${i}`, source: tasks[i].id, target: tasks[i + 1].id });
    }
    if (end && tasks.length) next.push({ id: `e${now}_e`, source: tasks[tasks.length - 1].id, target: end.id });
    if (!tasks.length && start && end) next.push({ id: `e${now}_se`, source: start.id, target: end.id });
    setEdges(next);
  };

  const nodeOptions = useMemo(() => nodes.map((n) => ({ value: n.id, label: `${n.id}${n.name ? ` · ${n.name}` : ''}` })), [nodes]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          노드 유형
          <select value={newNodeType} onChange={(e) => setNewNodeType(e.target.value as any)}>
            <option value="start">Start</option>
            <option value="task">Task</option>
            <option value="gateway_parallel">Parallel (AND)</option>
            <option value="gateway_xor">Exclusive (XOR)</option>
            <option value="end">End</option>
          </select>
        </label>
        <button type="button" className="btn" onClick={addNode}>노드 추가</button>
        <button type="button" className="btn" onClick={addEdge}>엣지 추가</button>
        <button type="button" className="btn btn-outline" onClick={autoLinearize}>선형 연결 자동생성</button>
      </div>
      {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}

      <div style={{ display: 'grid', gap: 8 }}>
        <h4>노드</h4>
        {nodes.length === 0 && <div style={{ fontSize: 12, color: '#6b7280' }}>노드를 추가하세요.</div>}
        {nodes.map((n) => (
          <div key={n.id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <b>{n.id}</b>
              <span style={{ color: '#6b7280' }}>{n.type}</span>
              <button type="button" className="btn btn-ghost" onClick={() => removeNode(n.id)}>삭제</button>
            </div>
            <label>
              이름
              <input value={n.name || ''} onChange={(e) => updateNode(n.id, { name: e.target.value })} />
            </label>
            {n.type === 'task' && (
              <>
                <label>
                  과제 타입
                  <select value={n.taskType || 'TASK'} onChange={(e) => updateNode(n.id, { taskType: e.target.value as any })}>
                    <option value="TASK">TASK</option>
                    <option value="WORKLOG">WORKLOG</option>
                    <option value="COOPERATION">COOPERATION</option>
                    <option value="APPROVAL">APPROVAL</option>
                  </select>
                </label>
                <div>
                  <label>설명</label>
                  <NodeDescEditor
                    nodeId={n.id}
                    initialHtml={n.description || ''}
                    onChangeHtml={(html) => updateNode(n.id, { description: html })}
                  />
                </div>
                <label>
                  담당자 힌트
                  <input value={n.assigneeHint || ''} onChange={(e) => updateNode(n.id, { assigneeHint: e.target.value })} />
                </label>
                <label>
                  스테이지
                  <input value={n.stageLabel || ''} onChange={(e) => updateNode(n.id, { stageLabel: e.target.value })} />
                </label>
                <label>
                  마감 오프셋(D+)
                  <input type="number" value={n.deadlineOffsetDays ?? ''} onChange={(e) => updateNode(n.id, { deadlineOffsetDays: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
              </>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <h4>엣지</h4>
        {edges.length === 0 && <div style={{ fontSize: 12, color: '#6b7280' }}>엣지를 추가하세요.</div>}
        {edges.map((e) => (
          <div key={e.id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <b>{e.id}</b>
              <button type="button" className="btn btn-ghost" onClick={() => removeEdge(e.id)}>삭제</button>
            </div>
            <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <label>
                Source
                <select value={e.source} onChange={(ev) => updateEdge(e.id, { source: ev.target.value })}>
                  {nodeOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Target
                <select value={e.target} onChange={(ev) => updateEdge(e.id, { target: ev.target.value })}>
                  {nodeOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              {/* 조건 입력은 기본 UI에서 숨김 처리 */}
            </div>
          </div>
        ))}
      </div>

      {/* 안내 문구도 기본 UI에서 숨김 처리 */}
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
                  const file = input.files?.[0];
                  if (!file) return;
                  const up = await uploadFile(file);
                  const range = (q as any).getSelection?.(true);
                  if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
                  else (q as any).insertEmbed(0, 'image', up.url, 'user');
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
    // paste & drop image handling
    const onPaste = async (e: any) => {
      try {
        const items = e.clipboardData?.items as DataTransferItemList | undefined;
        if (!items) return;
        const imgs = Array.from(items).filter((i: DataTransferItem) => i.type.startsWith('image/'));
        if (!imgs.length) return;
        e.preventDefault();
        for (const it of imgs) {
          const f = it.getAsFile();
          if (!f) continue;
          const up = await uploadFile(f);
          const range = (q as any).getSelection?.(true);
          if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
          else (q as any).insertEmbed(0, 'image', up.url, 'user');
        }
      } catch {}
    };
    const onDrop = async (e: any) => {
      try {
        const files = e.dataTransfer?.files as FileList | undefined;
        if (!files || !files.length) return;
        const imgs = Array.from(files).filter((f: File) => f.type.startsWith('image/'));
        if (!imgs.length) return;
        e.preventDefault();
        for (const f of imgs) {
          const up = await uploadFile(f);
          const range = (q as any).getSelection?.(true);
          if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
          else (q as any).insertEmbed(0, 'image', up.url, 'user');
        }
      } catch {}
    };
    elRef.current?.addEventListener('paste', onPaste);
    elRef.current?.addEventListener('drop', onDrop);
    try {
      applyingRef.current = true;
      q.setContents(q.clipboard.convert(initialHtml || ''));
      lastHtmlRef.current = q.root.innerHTML;
    } finally {
      applyingRef.current = false;
    }
    qref.current = q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function onAttachFiles(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const ups = await uploadFiles(files);
      const q = qref.current as any;
      const range = q?.getSelection?.(true);
      ups.forEach((f: any) => {
        const linkHtml = `<a href="${f.url}" target="_blank" rel="noreferrer">${f.name}</a>`;
        if (q && range) q.clipboard.dangerouslyPasteHTML(range.index, linkHtml);
        else if (q) q.clipboard.dangerouslyPasteHTML(0, linkHtml);
      });
      e.target.value = '' as any;
    } catch {}
  }

  return (
    <div>
      <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
        <div ref={(r) => (elRef.current = r)} style={{ minHeight: 140, width: '100%' }} />
      </div>
      <div style={{ marginTop: 6 }}>
        <label>첨부 파일</label>
        <input type="file" multiple onChange={onAttachFiles} />
        <span style={{ marginLeft: 8, color: '#9ca3af', fontSize: 12 }}>#{nodeId}</span>
      </div>
    </div>
  );
}
