import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';
import { UserPicker, type PickedUser } from '../components/UserPicker';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile, uploadFiles, type UploadResp } from '../lib/upload';
import '../styles/editor.css';

export function ApprovalsSubmit() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const processInstanceId = params?.get('processInstanceId') || '';
  const taskInstanceId = params?.get('taskInstanceId') || '';
  const [steps, setSteps] = useState<Array<{ id: string; name: string }>>([]);
  const [procTasks, setProcTasks] = useState<any[]>([]);
  const [selectedTask, setSelectedTask] = useState<{ instanceId: string; taskId: string } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [dueAt, setDueAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState('');
  const [teamName, setTeamName] = useState<string>(() => (typeof localStorage !== 'undefined' ? (localStorage.getItem('teamName') || '') : ''));
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [attachments, setAttachments] = useState<UploadResp[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);

  const requestedById = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  useEffect(() => {
    if (!editorEl.current) return;
    if (quillRef.current) return;
    const toolbar = [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['link', 'image'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      ['clean'],
    ];
    const q = new Quill(editorEl.current, {
      theme: 'snow',
      modules: {
        toolbar: {
          container: toolbar,
          handlers: { image: onImageUpload },
        },
      },
      placeholder: '결재 내용을 입력하고, 이미지 버튼으로 그림을 업로드하세요.',
    } as any);
    q.on('text-change', () => setContentHtml(q.root.innerHTML));
    // robust paste/drop handlers to avoid navigation and large base64 embeds
    const onPaste = async (e: ClipboardEvent) => {
      try {
        const items = e.clipboardData?.items as DataTransferItemList | undefined;
        if (!items) return;
        const imgs = Array.from(items).filter((i: DataTransferItem) => i.type.startsWith('image/'));
        if (!imgs.length) return;
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
      } catch (err: any) {
        setError(err?.message || '이미지 업로드 실패');
      }
    };
    const onDrop = async (e: DragEvent) => {
      try {
        const files = e.dataTransfer?.files as FileList | undefined;
        if (!files || !files.length) return;
        const imgs = Array.from(files).filter((f: File) => f.type.startsWith('image/'));
        if (!imgs.length) return;
        e.preventDefault();
        e.stopPropagation();
        for (const f of imgs) {
          const up = await uploadFile(f);
          const range = (q as any).getSelection?.(true);
          if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
          else (q as any).insertEmbed(0, 'image', up.url, 'user');
        }
      } catch (err: any) {
        setError(err?.message || '이미지 업로드 실패');
      }
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    (q.root as HTMLElement)?.addEventListener('paste', onPaste as any);
    (q.root as HTMLElement)?.addEventListener('drop', onDrop as any);
    (q.root as HTMLElement)?.addEventListener('dragover', onDragOver as any);
    quillRef.current = q;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!requestedById) return;
        const items = await apiJson<any[]>(`/api/processes/inbox?assigneeId=${encodeURIComponent(requestedById)}&status=READY`);
        const list = (items || []).filter((t: any) => String(t.taskType).toUpperCase() === 'APPROVAL');
        setProcTasks(list);
        // If params were provided via URL, prefer that as selected
        if (processInstanceId && taskInstanceId) setSelectedTask({ instanceId: processInstanceId, taskId: taskInstanceId });
      } catch {}
    })();
  }, [requestedById]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/orgs`);
        const options = (res.items || []).filter((u: any) => u.type === 'TEAM').map((u: any) => u.name).sort();
        setTeams(options);
        if (!teamName && options.length > 0) setTeamName(options[0]);
      } catch {}
    })();
  }, []);

  function addStep(u: PickedUser) {
    setSteps((prev) => [...prev, { id: u.id, name: u.name }]);
    setShowPicker(false);
  }

  function removeStep(idx: number) {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return next;
      const t = next[idx];
      next[idx] = next[j];
      next[j] = t;
      return next;
    });
  }

  function stripHtml(html: string) {
    const el = document.createElement('div');
    el.innerHTML = html || '';
    return (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
  }

  async function onImageUpload() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        try {
          const file = input.files?.[0];
          if (!file) return;
          const up = await uploadFile(file);
          const editor = quillRef.current as any;
          const range = editor?.getSelection?.(true);
          if (editor && range) {
            editor.insertEmbed(range.index, 'image', up.url, 'user');
            editor.setSelection(range.index + 1, 0, 'user');
          } else if (editor) {
            editor.insertEmbed(0, 'image', up.url, 'user');
          }
        } catch (e: any) {
          setError(e?.message || '이미지 업로드 실패');
        }
      };
      input.click();
    } catch (e: any) {
      setError(e?.message || '이미지 업로드 실패');
    }
  }

  async function onAttachFiles(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const ups = await uploadFiles(files);
      setAttachments((prev) => [...prev, ...ups]);
      e.target.value = '' as any;
    } catch (e: any) {
      setError(e?.message || '파일 업로드 실패');
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!requestedById) { setError('로그인이 필요합니다.'); return; }
    const missing: string[] = [];
    if (!teamName) missing.push('팀명');
    if (!title) missing.push('제목');
    if (!stripHtml(contentHtml)) missing.push('내용');
    if (steps.length === 0) missing.push('결재자');
    if (missing.length) { setError(`${missing.join(', ')} 입력이 필요합니다.`); return; }
    setLoading(true);
    setError(null);
    setOkMsg('');
    try {
      const res = await apiJson<{ id: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({
            userId: requestedById,
            teamName,
            taskName: title || 'Approval',
            title,
            content: stripHtml(contentHtml),
            contentHtml: contentHtml || undefined,
            attachments: { files: attachments },
          }),
        }
      );
      const body: any = { subjectType: 'Worklog', subjectId: res.id, requestedById };
      body.steps = steps.map((s) => ({ approverId: s.id }));
      if (dueAt) body.dueAt = new Date(dueAt).toISOString();
      const res2 = await apiJson<any>('/api/approvals', { method: 'POST', body: JSON.stringify(body) });
      // If invoked from a process task, complete it with approvalRequestId
      const linkage = selectedTask || (processInstanceId && taskInstanceId ? { instanceId: processInstanceId, taskId: taskInstanceId } : null);
      if (linkage && res2?.id) {
        try {
          await apiJson(`/api/processes/${encodeURIComponent(linkage.instanceId)}/tasks/${encodeURIComponent(linkage.taskId)}/complete`, {
            method: 'POST',
            body: JSON.stringify({ approvalRequestId: res2.id }),
          });
        } catch {}
      }
      setOkMsg(`요청 완료: ${res2?.id || ''}`);
      setSteps([]);
      setDueAt('');
      setTitle('');
      setContentHtml('');
      setAttachments([]);
      setSelectedTask(null);
    } catch (e: any) {
      setError(e?.message || '요청 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 640, margin: '24px auto' }}>
      {requestedById ? null : <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {okMsg && <div style={{ color: '#0F3D73' }}>{okMsg}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        <h3>프로세스 결재 대상 (선택)</h3>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gap: 8 }}>
          {(procTasks || []).map((t: any) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <b>{t.instance?.title || '-'}</b>
                <span style={{ marginLeft: 8, color: '#64748b' }}>{t.stageLabel ? `· ${t.stageLabel}` : ''}</span>
                <div style={{ fontSize: 12, color: '#334155' }}>{t.name}</div>
              </div>
              <button type="button" style={ghostBtn} onClick={() => setSelectedTask({ instanceId: t.instance?.id, taskId: t.id })}>
                {selectedTask?.taskId === t.id ? '선택됨' : '선택'}
              </button>
            </div>
          ))}
          {!procTasks.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>현재 결재 대상 프로세스 과제가 없습니다.</div>}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <label>팀</label>
        <select value={teamName} onChange={(e) => setTeamName(e.target.value)} style={input}>
          {teams.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <label>제목</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
        <label>결재선</label>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            {steps.map((s, idx) => (
              <div key={`${s.id}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={chip}>{idx + 1}</span>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: '#64748b' }}>({s.id})</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button type="button" style={ghostBtn} onClick={() => moveStep(idx, -1)}>▲</button>
                  <button type="button" style={ghostBtn} onClick={() => moveStep(idx, 1)}>▼</button>
                  <button type="button" style={ghostBtn} onClick={() => removeStep(idx)}>삭제</button>
                </span>
              </div>
            ))}
            <div>
              <button type="button" style={primaryBtn} onClick={() => setShowPicker(true)}>결재자 추가</button>
              {showPicker && (
                <div style={{ marginTop: 8 }}>
                  <UserPicker onSelect={addStep} onClose={() => setShowPicker(false)} />
                </div>
              )}
            </div>
          </div>
        </div>
        <label>기한(선택)</label>
        <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={input} />
        <label>내용</label>
        <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
          <div ref={(r) => (editorEl.current = r)} style={{ minHeight: 240, width: '100%' }} />
        </div>
        <label>첨부 파일</label>
        <input type="file" multiple onChange={onAttachFiles} />
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((f, i) => (
              <div key={f.filename + i} className="attachment-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a className="file-link" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeAttachment(i)}>삭제</button>
              </div>
            ))}
          </div>
        )}
        <button onClick={submit} disabled={!requestedById || loading} style={primaryBtn}>
          {loading ? '요청중…' : '결재 요청'}
        </button>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '6px 10px',
  fontWeight: 600,
};

const chip: React.CSSProperties = {
  background: '#E6EEF7',
  color: '#0F3D73',
  border: '1px solid #0F3D73',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 12,
  fontWeight: 700,
};
