import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { BpmnEditor } from '../components/BpmnEditor';
import { BpmnFormEditor } from '../components/BpmnFormEditor';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile } from '../lib/upload';
import '../styles/editor.css';

interface ProcessTaskTemplateDto {
  id?: string;
  name: string;
  description?: string;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  orderHint?: number;
   stageLabel?: string;
  predecessorIds?: string;
  assigneeType?: 'USER' | 'ORG_UNIT' | 'ROLE';
  assigneeUserId?: string;
  assigneeOrgUnitId?: string;
  assigneeRoleCode?: string;
  deadlineOffsetDays?: number;
}

interface ProcessTemplateDto {
  id?: string;
  title: string;
  description?: string;
  type: 'RECURRING' | 'PROJECT';
  ownerId: string;
  visibility: 'PUBLIC' | 'ORG_UNIT' | 'PRIVATE';
  orgUnitId?: string;
  recurrenceType?: string;
  recurrenceDetail?: string;
  bpmnJson?: any;
  resultInputRequired?: boolean;
  expectedDurationDays?: number;
  expectedCompletionCriteria?: string;
  allowExtendDeadline?: boolean;
  status?: string;
  official?: boolean;
  tasks: ProcessTaskTemplateDto[];
  createdAt?: string;
  updatedAt?: string;
  owner?: { id: string; name: string; orgUnit?: { id: string; name: string } };
  createdBy?: { id: string; name: string };
  updatedBy?: { id: string; name: string };
  orgUnit?: { id: string; name: string };
}

export function ProcessTemplates() {
  function stripHtml(html: string): string {
    if (!html) return '';
    const el = typeof document !== 'undefined' ? document.createElement('div') : null;
    if (!el) return String(html).replace(/<[^>]+>/g, ' ');
    el.innerHTML = html;
    return (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
  }
  function fmt(s?: string) {
    if (!s) return '';
    try { return new Date(s).toLocaleString(); } catch { return s; }
  }
  const nav = useNavigate();
  const [items, setItems] = useState<ProcessTemplateDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProcessTemplateDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | ''>('');
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [itemsMaster, setItemsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [moldsMaster, setMoldsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [carModelsMaster, setCarModelsMaster] = useState<Array<{ code: string; name: string }>>([]);
  const [bpmnJsonText, setBpmnJsonText] = useState('');
  const [bpmnMode, setBpmnMode] = useState<'graph' | 'form'>('graph');
  
  const [inUseCount, setInUseCount] = useState<number>(0);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneTitle, setCloneTitle] = useState('');

  // Rich editor for process template description
  const descEditorEl = useRef<HTMLDivElement | null>(null);
  const descQuillRef = useRef<Quill | null>(null);
  const [descHtml, setDescHtml] = useState('');
  const descAttachInputRef = useRef<HTMLInputElement | null>(null);
  const [descAttachOneDriveOk, setDescAttachOneDriveOk] = useState<boolean>(false);
  const ensureDescQuill = () => {
    if (descQuillRef.current || !descEditorEl.current) return;
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
    const q = new Quill(descEditorEl.current, {
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
      placeholder: '업무 프로세스 정의를 입력하세요. 파일 링크나 이미지를 삽입할 수 있습니다.',
    } as any);
    q.on('text-change', () => setDescHtml(q.root.innerHTML));
    q.enable(true);
    descQuillRef.current = q;
    const onPaste = async (e: ClipboardEvent) => {
      try {
        const items = e.clipboardData?.items as DataTransferItemList | undefined;
        if (!items) return;
        const imgs: DataTransferItem[] = Array.from(items).filter((i: DataTransferItem) => i.type.startsWith('image/'));
        const html = e.clipboardData?.getData('text/html') || '';
        if (imgs.length) {
          e.preventDefault();
          e.stopPropagation();
          for (const it of imgs) {
            const f = it.getAsFile();
            if (!f) continue;
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
          return;
        }
      } catch {
        alert('이미지 처리에 실패했습니다. 이미지 URL을 사용하세요.');
      }
    };
    const onDrop = async (e: DragEvent) => {
      try {
        const html = (e.dataTransfer && (e.dataTransfer.getData && e.dataTransfer.getData('text/html'))) || '';
        const files = e.dataTransfer?.files as FileList | undefined;
        const imgs: File[] = files ? Array.from(files).filter((f: File) => f.type.startsWith('image/')) : [];
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
      } catch {
        alert('이미지 처리에 실패했습니다. 이미지 URL을 사용하세요.');
      }
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    (q.root as HTMLElement)?.addEventListener('paste', onPaste as any);
    (q.root as HTMLElement)?.addEventListener('drop', onDrop as any);
    (q.root as HTMLElement)?.addEventListener('dragover', onDragOver as any);
  };
  async function replaceDataUrisInHtml(html: string): Promise<string> {
    try {
      if (!html || (!html.includes('src="data:') && !html.includes("src='data:"))) return html || '';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const imgs = Array.from(doc.images || []).filter((im) => im.src && im.src.startsWith('data:'));
      for (const im of imgs) {
        try {
          const res = await fetch(im.src);
          const blob = await res.blob();
          const ext = blob.type.includes('png') ? 'png' : (blob.type.includes('gif') ? 'gif' : (blob.type.includes('webp') ? 'webp' : 'jpg'));
          const f = new File([blob], 'img.' + ext, { type: blob.type });
          const up = await uploadFile(f);
          im.src = up.url;
        } catch {
          im.remove();
        }
      }
      return doc.body.innerHTML;
    } catch {
      return html || '';
    }
  }

  async function sanitizeBpmnJsonDescriptions(bpmn: any): Promise<any> {
    try {
      const nodes = Array.isArray(bpmn?.nodes) ? bpmn.nodes : [];
      for (const n of nodes) {
        const desc = typeof n?.description === 'string' ? n.description : '';
        if (desc && (desc.includes('src="data:') || desc.includes("src='data:"))) {
          n.description = await replaceDataUrisInHtml(desc);
        }
      }
      return bpmn;
    } catch {
      return bpmn;
    }
  }

  const taskPreview = (() => {
    try {
      if (bpmnJsonText.trim()) {
        const j = JSON.parse(bpmnJsonText);
        const nodes = Array.isArray(j?.nodes) ? j.nodes : [];
        return nodes
          .filter((n: any) => n?.type === 'task')
          .map((n: any, idx: number) => ({
            id: String(n.id ?? idx),
            name: n.name || '',
            taskType: (n.taskType || 'TASK') as ProcessTaskTemplateDto['taskType'],
            description: n.description || '',
            stageLabel: n.stageLabel || '',
            deadlineOffsetDays: typeof n.deadlineOffsetDays === 'number' ? n.deadlineOffsetDays : undefined,
          }));
      }
    } catch {}
    return (editing?.tasks || []).map((t, idx) => ({
      id: String(t.id ?? idx),
      name: t.name,
      taskType: t.taskType,
      description: t.description || '',
      stageLabel: t.stageLabel || '',
      deadlineOffsetDays: t.deadlineOffsetDays,
    }));
  })();

  useEffect(() => {
    loadList();
  }, []);

  useEffect(() => {
    if (!editing) return;
    ensureDescQuill();
  }, [editing]);

  useEffect(() => {
    ensureDescQuill();
    const html = (editing?.description || '').toString();
    setDescHtml(html);
    try {
      descQuillRef.current?.setContents([] as any);
      descQuillRef.current?.clipboard.dangerouslyPasteHTML(html || '');
    } catch {}
  }, [selectedId]);

  useEffect(() => {
    const t = setTimeout(() => ensureDescQuill(), 0);
    return () => clearTimeout(t);
  }, [editing, selectedId]);

  async function addDescAttachmentFiles(list: FileList | null) {
    const q = descQuillRef.current as any;
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

  async function checkInUse(tmplId?: string | null) {
    if (!tmplId) { setInUseCount(0); return; }
    try {
      // Consider any instance (all statuses), to match backend FK constraint behavior
      const rows = await apiJson<any[]>(`/api/processes?templateId=${encodeURIComponent(tmplId)}`);
      setInUseCount((rows || []).length);
    } catch {
      setInUseCount(0);
    }
  }


  async function loadList() {
    setLoading(true);
    try {
      const res = await apiJson<ProcessTemplateDto[]>(`/api/process-templates`);
      setItems(res || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      if (!userId) {
        setMyRole('');
        return;
      }
      try {
        const me = await apiJson<{ role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setMyRole((me?.role as any) || '');
      } catch {
        setMyRole('');
      }
    })();
  }, [userId]);
  

  function newTemplate() {
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    const t: ProcessTemplateDto = {
      title: '',
      description: '',
      type: 'PROJECT',
      ownerId: userId,
      visibility: 'PUBLIC',
      recurrenceType: '',
      recurrenceDetail: '',
      resultInputRequired: false,
      expectedDurationDays: undefined,
      expectedCompletionCriteria: '',
      allowExtendDeadline: true,
      status: 'ACTIVE',
      tasks: [],
    };
    setSelectedId(null);
    setEditing(t);
    setBpmnJsonText('');
    setInUseCount(0);
    setCloneTitle('');
  }

  async function promote() {
    if (!editing?.id) return;
    if (!userId) {
      alert('로그인이 필요합니다.');
      return;
    }
    if (!(myRole === 'CEO' || myRole === 'EXEC')) {
      alert('공식 템플릿 지정 권한이 없습니다.');
      return;
    }
    try {
      await apiJson(`/api/process-templates/${encodeURIComponent(editing.id)}/promote`, {
        method: 'POST',
        body: JSON.stringify({ actorId: userId }),
      });
      await loadList();
      setEditing((prev) => (prev ? { ...prev, official: true } : prev) as any);
      alert('공식 템플릿으로 지정되었습니다.');
    } catch (e: any) {
      alert('공식 지정에 실패했습니다. 권한이 없을 수 있습니다.');
    }
  }

  function editTemplate(t: ProcessTemplateDto) {
    setSelectedId(t.id || null);
    setEditing({
      ...t,
      tasks: (t.tasks || []).map((x, idx) => ({
        ...x,
        orderHint: x.orderHint ?? idx,
      })),
    });
    checkInUse(t.id || null);
    setCloneTitle(((t.title || '') + ' (사본)').trim());
    try {
      const raw: any = (t as any).bpmnJson;
      if (!raw) {
        setBpmnJsonText('');
      } else if (typeof raw === 'string') {
        // 이미 문자열(JSON 텍스트)로 저장된 경우 그대로 사용
        setBpmnJsonText(raw);
      } else {
        setBpmnJsonText(JSON.stringify(raw, null, 2));
      }
    } catch {
      setBpmnJsonText('');
    }
  }

  function updateTask(idx: number, patch: Partial<ProcessTaskTemplateDto>) {
    if (!editing) return;
    const nextTasks = editing.tasks.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    setEditing({ ...editing, tasks: nextTasks });
  }

  function addTask() {
    if (!editing) return;
    const next: ProcessTaskTemplateDto = {
      name: '',
      taskType: 'TASK',
      orderHint: editing.tasks.length,
    };
    setEditing({ ...editing, tasks: [...editing.tasks, next] });
  }

  function removeTask(idx: number) {
    if (!editing) return;
    const next = editing.tasks.filter((_, i) => i !== idx).map((t, i) => ({ ...t, orderHint: i }));
    setEditing({ ...editing, tasks: next });
  }

  async function save() {
    if (!editing) return;
    if (!editing.title.trim()) {
      alert('업무프로세스 제목을 입력하세요.');
      return;
    }
    // Apply rich text description content
    let desc = descHtml || '';
    // Replace any embedded data URI images in description with uploaded URLs
    try { desc = await replaceDataUrisInHtml(desc); } catch {}
    const editingWithDesc = { ...editing, description: desc } as ProcessTemplateDto;
    let bpmnObj: any = undefined;
    const raw = (bpmnJsonText || '').trim();
    if (raw) {
      try {
        bpmnObj = JSON.parse(raw);
      } catch {
        // 혹시 문자열 형태로 저장되어 있을 수도 있으므로, 파싱 실패 시 그대로 전달하지 않고 취소
        alert('BPMN JSON이 유효하지 않습니다.');
        return;
      }
    } else if ((editing as any).bpmnJson) {
      // 편집기 자동 동기화 이전에 열려 있던 경우 대비: 기존 저장된 bpmnJson을 유지 저장
      bpmnObj = (editing as any).bpmnJson;
    }
    // Sanitize node descriptions: convert any data URI images to uploaded URLs
    if (bpmnObj) {
      try { bpmnObj = await sanitizeBpmnJsonDescriptions(bpmnObj); } catch {}
    }
    const body = {
      ...editingWithDesc,
      bpmnJson: bpmnObj,
      tasks: editing.tasks,
      actorId: userId,
    };
    if (editing.id) {
      // If template is in use, enforce clone-as-new with new title
      if (inUseCount > 0) {
        setShowCloneModal(true);
        return;
      }
      await apiJson(`/api/process-templates/${encodeURIComponent(editing.id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } else {
      const created = await apiJson<ProcessTemplateDto>(`/api/process-templates`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setSelectedId(created.id || null);
    }
    await loadList();
    alert('업무 프로세스 템플릿이 저장되었습니다.');
  }

  function autoLinearizeEdges() {
    try {
      const raw = (bpmnJsonText || '').trim();
      if (!raw) {
        alert('BPMN JSON이 없습니다. 먼저 그래프/폼 편집기로 노드를 추가하세요.');
        return;
      }
      const j: any = JSON.parse(raw || '{}');
      const nodes: any[] = Array.isArray(j?.nodes) ? j.nodes : [];
      if (!nodes.length) {
        alert('노드가 없습니다. 먼저 노드를 추가하세요.');
        return;
      }
      const normType = (t: any) => String(t || 'task').toLowerCase();
      const tasks = nodes.filter((n: any) => normType(n.type) === 'task');
      const start = nodes.find((n: any) => normType(n.type) === 'start');
      const end = nodes.find((n: any) => normType(n.type) === 'end');
      const eidBase = Date.now();
      const edges: any[] = [];
      if (start && tasks[0]) edges.push({ id: `e${eidBase}_s`, source: String(start.id), target: String(tasks[0].id) });
      for (let i = 0; i < tasks.length - 1; i++) {
        edges.push({ id: `e${eidBase}_${i}`, source: String(tasks[i].id), target: String(tasks[i + 1].id) });
      }
      if (end && tasks.length) edges.push({ id: `e${eidBase}_e`, source: String(tasks[tasks.length - 1].id), target: String(end.id) });
      if (Array.isArray(j.edges) && j.edges.length > 0) {
        const ok = confirm(`기존 엣지 ${j.edges.length}개를 모두 삭제하고 순차 연결로 대체할까요?`);
        if (!ok) return;
      }
      j.edges = edges;
      setBpmnJsonText(JSON.stringify(j, null, 2));
      alert('선형 연결이 생성되었습니다. 저장하면 선행 관계가 반영됩니다.');
    } catch (e) {
      alert('BPMN JSON이 유효하지 않습니다.');
    }
  }

  

  async function removeTemplate(id?: string) {
    if (!id) return;
    if (!confirm('정말 삭제하시겠습니까? 이 프로세스의 단계 정의도 함께 삭제됩니다.')) return;
    try {
      await apiJson(`/api/process-templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setEditing(null);
      setSelectedId(null);
      await loadList();
    } catch (e: any) {
      const msg = e?.message || '삭제 중 오류가 발생했습니다.';
      alert(msg);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: listCollapsed ? '20px minmax(0, 1fr)' : 'minmax(0, 320px) 20px minmax(0, 1fr)',
          gap: 16,
          alignItems: 'stretch',
        }}
      >
      {!listCollapsed && (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2>프로세스 템플릿 목록</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={newTemplate}>새 템플릿</button>
          </div>
        </div>
        {loading && <div>불러오는 중...</div>}
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((it) => (
            <div
              key={it.id}
              onClick={() => editTemplate(it)}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 8,
                cursor: 'pointer',
                background: editing?.id === it.id ? '#eff6ff' : '#ffffff',
              }}
            >
              <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{it.title}</span>
                {it.official ? (
                  <span style={{ fontSize: 11, color: '#065f46', background: '#d1fae5', border: '1px solid #34d399', padding: '0px 6px', borderRadius: 6 }}>공식</span>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{stripHtml(it.description || '').slice(0, 180)}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                유형: {it.type === 'RECURRING' ? '반복' : '프로젝트'} · 공개: {it.visibility}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                최초 작성: {it.createdBy?.name || it.owner?.name || '-'} · {fmt(it.createdAt)}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                최종 수정: {it.updatedBy?.name || it.createdBy?.name || it.owner?.name || '-'} · {fmt(it.updatedAt)}
              </div>
            </div>
          ))}
          {!items.length && !loading && <div style={{ fontSize: 12, color: '#9ca3af' }}>아직 정의된 프로세스 템플릿이 없습니다.</div>}
        </div>
      </div>
      )}
      {/* Toggle column (sticky near viewport center) */}
      <div style={{ alignSelf: 'start', position: 'sticky', top: '50vh', transform: 'translateY(-50%)', display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: '100%', height: 80, padding: 0, fontSize: 18, lineHeight: 1 }}
          onClick={() => setListCollapsed((v) => !v)}
          title={listCollapsed ? '목록 펼치기' : '목록 접기'}
          aria-label={listCollapsed ? '목록 펼치기' : '목록 접기'}
        >
          {listCollapsed ? '◀' : '▶'}
        </button>
      </div>

      <div>
        {editing ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <h2>업무 프로세스 정의</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {editing?.official ? (
                  <span style={{ fontSize: 12, color: '#065f46', background: '#d1fae5', border: '1px solid #34d399', padding: '2px 6px', borderRadius: 6 }}>★ 공식 템플릿</span>
                ) : (
                  (myRole === 'CEO' || myRole === 'EXEC') ? <button className="btn btn-warning" onClick={promote} disabled={!editing?.id}>공식 지정</button> : null
                )}
              </div>
              {editing?.id ? (
                <span style={{ fontSize: 12, color: '#64748b' }}>
                  기존 인스턴스: {inUseCount}건 {inUseCount > 0 ? '· 구조 변경은 복제로 저장됩니다' : ''}
                </span>
              ) : null}
              <span style={{ fontSize: 12, color: '#64748b' }}>
                📝 최초 작성: {(editing.createdBy?.name || editing.owner?.name || '-')}{editing.createdAt ? ` · ${fmt(editing.createdAt)}` : ''}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                ✏️ 최종 수정: {(editing.updatedBy?.name || editing.createdBy?.name || editing.owner?.name || '-')}{editing.updatedAt ? ` · ${fmt(editing.updatedAt)}` : ''}
              </span>
            </div>
            <div>
              <label>업무프로세스 제목</label>
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              />
            </div>
            <div>
              <label>업무 프로세스 정의</label>
              <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
                <div ref={(r) => (descEditorEl.current = r)} style={{ minHeight: 180, width: '100%' }} />
              </div>
              <div style={{ marginTop: 6 }}>
                <label>첨부 파일</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    ref={descAttachInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      addDescAttachmentFiles(e.currentTarget.files);
                      e.currentTarget.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      if (!descAttachOneDriveOk) {
                        const ok = window.confirm('원드라이브(회사)에서 받은 파일만 업로드하세요. 계속할까요?');
                        if (!ok) return;
                        setDescAttachOneDriveOk(true);
                      }
                      descAttachInputRef.current?.click();
                    }}
                  >파일 선택</button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => window.open('https://office.com/launch/onedrive', '_blank', 'noopener,noreferrer')}
                  >OneDrive 열기</button>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
                  <input type="checkbox" checked={descAttachOneDriveOk} onChange={(e) => setDescAttachOneDriveOk(e.target.checked)} />
                  원드라이브 파일만 업로드합니다
                </label>
                <div style={{ fontSize: 12, color: '#64748b' }}>원드라이브 파일만 올려주세요. 업로드하면 본문에 링크로 삽입됩니다. (브라우저 제한으로 원드라이브 폴더를 자동으로 열 수는 없습니다)</div>
              </div>
            </div>
            <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <div>
                <label>유형</label>
                <select
                  value={editing.type}
                  onChange={(e) => setEditing({ ...editing, type: e.target.value as any })}
                >
                  <option value="RECURRING">반복성</option>
                  <option value="PROJECT">프로젝트성</option>
                </select>
              </div>
              <div>
                <label>공개 범위</label>
                <select
                  value={editing.visibility}
                  onChange={(e) => setEditing({ ...editing, visibility: e.target.value as any })}
                >
                  <option value="PUBLIC">전체 공개</option>
                  <option value="ORG_UNIT">팀 공개</option>
                  <option value="PRIVATE">개인용</option>
                </select>
              </div>
              <div>
                <label>완료 기한 연장 허용</label>
                <select
                  value={editing.allowExtendDeadline ? 'yes' : 'no'}
                  onChange={(e) => setEditing({ ...editing, allowExtendDeadline: e.target.value === 'yes' })}
                >
                  <option value="yes">예</option>
                  <option value="no">아니오</option>
                </select>
              </div>
            </div>
            {editing.type === 'RECURRING' ? (
              <div className="resp-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                <div>
                  <label>주기</label>
                  <select
                    value={editing.recurrenceType || ''}
                    onChange={(e) => setEditing({ ...editing, recurrenceType: e.target.value })}
                  >
                    <option value="">선택</option>
                    <option value="DAILY">일간</option>
                    <option value="WEEKLY">주간</option>
                    <option value="MONTHLY">월간</option>
                    <option value="QUARTERLY">분기</option>
                    <option value="YEARLY">연간</option>
                  </select>
                </div>
                <div>
                  <label>주기 상세</label>
                  <input
                    placeholder="예: 매월 10일 보고"
                    value={editing.recurrenceDetail || ''}
                    onChange={(e) => setEditing({ ...editing, recurrenceDetail: e.target.value })}
                  />
                </div>
                <div>
                  <label>주기적 결과 입력 필요</label>
                  <select
                    value={editing.resultInputRequired ? 'yes' : 'no'}
                    onChange={(e) => setEditing({ ...editing, resultInputRequired: e.target.value === 'yes' })}
                  >
                    <option value="no">아니오</option>
                    <option value="yes">예</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                <div>
                  <label>예상 소요 일수</label>
                  <input
                    type="number"
                    value={editing.expectedDurationDays ?? ''}
                    onChange={(e) =>
                      setEditing({ ...editing, expectedDurationDays: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </div>
                <div>
                  <label>완료 기대 수준</label>
                  <input
                    value={editing.expectedCompletionCriteria || ''}
                    onChange={(e) => setEditing({ ...editing, expectedCompletionCriteria: e.target.value })}
                  />
                </div>
              </div>
            )}
            <div>
              <label>업무 흐름 정의</label>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', borderBottom: '1px solid #e5e7eb' }}>
                  <button
                    type="button"
                    onClick={() => setBpmnMode('graph')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: bpmnMode === 'graph' ? '2px solid #0F3D73' : '2px solid transparent',
                      fontWeight: bpmnMode === 'graph' ? 700 : 500,
                      color: bpmnMode === 'graph' ? '#0F3D73' : '#374151',
                    }}
                  >그래프 편집</button>
                  <button
                    type="button"
                    onClick={() => setBpmnMode('form')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: bpmnMode === 'form' ? '2px solid #0F3D73' : '2px solid transparent',
                      fontWeight: bpmnMode === 'form' ? 700 : 500,
                      color: bpmnMode === 'form' ? '#0F3D73' : '#374151',
                    }}
                  >순차 폼 편집</button>
                </div>
                {bpmnMode === 'graph' ? (
                  <BpmnEditor jsonText={bpmnJsonText} onChangeJson={setBpmnJsonText} height={'80vh'} />
                ) : (
                  <BpmnFormEditor jsonText={bpmnJsonText} onChangeJson={setBpmnJsonText} />
                )}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>저장 시 아래 과제 목록은 편집된 흐름 기준으로 재생성됩니다.</div>
            </div>
            
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <h3>과제 미리보기 (읽기 전용)</h3>
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gap: 8 }}>
                {taskPreview.map((t: any, idx: number) => (
                  <div key={t.id || idx} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <b>#{idx + 1}</b>
                      <span style={{ color: '#6b7280' }}>{t.taskType}</span>
                    </div>
                    <div className="resp-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                      <div>
                        <label>과제 이름</label>
                        <div>{t.name || '-'}</div>
                      </div>
                      {false && (
                        <div>
                          <label>마감 기한 오프셋(D+)</label>
                          <div>{typeof t.deadlineOffsetDays === 'number' ? t.deadlineOffsetDays : '-'}</div>
                        </div>
                      )}
                    </div>
                    {t.description ? (
                      <div>
                        <label>설명</label>
                        <div>{t.description}</div>
                      </div>
                    ) : null}
                  </div>
                ))}
                {!taskPreview.length && (
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>BPMN에서 Task 노드를 추가하면 미리보기가 나타납니다.</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <button
                className="btn btn-outline"
                disabled={!editing.id}
                onClick={() => removeTemplate(editing.id)}
              >
                템플릿 삭제
              </button>
              <button className="btn btn-primary" onClick={save}>저장</button>
            </div>
          </div>
        ) : (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>왼쪽에서 템플릿을 선택하거나 "새 템플릿"을 눌러 업무 프로세스를 정의하세요.</div>
        )}
      </div>
      </div>
      {showCloneModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 16, width: 420, display: 'grid', gap: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>실행 중인 프로세스가 있어 복제로 저장해야 합니다</div>
            <div style={{ color: '#64748b', fontSize: 13 }}>
              이 템플릿은 실행 중 인스턴스가 있어 구조 변경이 불가합니다. 제목을 변경하여 새 템플릿으로 저장하세요.
            </div>
            <div>
              <label>새 템플릿 제목</label>
              <input value={cloneTitle} onChange={(e) => setCloneTitle(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'end', gap: 8 }}>
              <button className="btn" onClick={() => setShowCloneModal(false)}>취소</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!editing) return;
                  if (!cloneTitle.trim()) { alert('제목을 입력하세요.'); return; }
                  let bpmnObj: any = undefined;
                  try { bpmnObj = bpmnJsonText?.trim() ? JSON.parse(bpmnJsonText) : undefined; } catch {}
                  const body = { ...editing, id: undefined, ownerId: userId, title: cloneTitle.trim(), description: descHtml || editing.description || '', bpmnJson: bpmnObj, actorId: userId } as any;
                  const created = await apiJson<ProcessTemplateDto>(`/api/process-templates`, { method: 'POST', body: JSON.stringify(body) });
                  setShowCloneModal(false);
                  await loadList();
                  setSelectedId(created.id || null);
                  setEditing(created);
                  alert('새 템플릿으로 저장되었습니다.');
                }}
              >새 템플릿으로 저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
