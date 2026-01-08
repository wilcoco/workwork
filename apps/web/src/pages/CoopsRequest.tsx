import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile } from '../lib/upload';
import '../styles/editor.css';

export function CoopsRequest() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const processInstanceId = params?.get('processInstanceId') || '';
  const taskInstanceId = params?.get('taskInstanceId') || '';
  const [procTasks, setProcTasks] = useState<any[]>([]);
  const [selectedTask, setSelectedTask] = useState<{ instanceId: string; taskId: string } | null>(null);
  const [category, setCategory] = useState('General');
  const [queue, setQueue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);
  const [slaMinutes, setSlaMinutes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState('');
  const [teamName, setTeamName] = useState<string>(() => (typeof localStorage !== 'undefined' ? (localStorage.getItem('teamName') || '') : ''));
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [attachments, setAttachments] = useState<Array<{ url: string; name?: string; filename?: string }>>([]);
  const [attachUrl, setAttachUrl] = useState('');
  const [teams, setTeams] = useState<string[]>([]);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);

  const requesterId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

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
      placeholder: '협조 요청 내용을 입력하고, 이미지 버튼으로 그림을 업로드하세요.',
    } as any);
    q.on('text-change', () => setContentHtml(q.root.innerHTML));
    // robust paste/drop to avoid navigation and base64 embeds
    const onPaste = async (e: ClipboardEvent) => {
      try {
        const items = e.clipboardData?.items as DataTransferItemList | undefined;
        if (!items) return;
        const imgs = Array.from(items).filter((i: DataTransferItem) => i.type.startsWith('image/'));
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
      } catch (e: any) {
        setError(e?.message || '이미지 업로드 실패');
      }
    };
    const onDrop = async (e: DragEvent) => {
      try {
        const files = e.dataTransfer?.files as FileList | undefined;
        if (!files || !files.length) return;
        const imgs = Array.from(files).filter((f: File) => f.type.startsWith('image/'));
        if (imgs.length) {
          e.preventDefault();
          e.stopPropagation();
          for (const f of imgs) {
            const up = await uploadFile(f);
            const range = (q as any).getSelection?.(true);
            if (range) (q as any).insertEmbed(range.index, 'image', up.url, 'user');
            else (q as any).insertEmbed(0, 'image', up.url, 'user');
          }
        }
      } catch (e: any) {
        setError(e?.message || '이미지 업로드 실패');
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
        const res = await apiJson<{ items: any[] }>(`/api/orgs`);
        const options = (res.items || []).filter((u: any) => u.type === 'TEAM').map((u: any) => u.name).sort();
        setTeams(options);
        if (!teamName && options.length > 0) setTeamName(options[0]);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!requesterId) return;
        const items = await apiJson<any[]>(`/api/processes/inbox?assigneeId=${encodeURIComponent(requesterId)}&status=READY`);
        const list = (items || []).filter((t: any) => String(t.taskType).toUpperCase() === 'COOPERATION');
        setProcTasks(list);
        if (processInstanceId && taskInstanceId) setSelectedTask({ instanceId: processInstanceId, taskId: taskInstanceId });
      } catch {}
    })();
  }, [requesterId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: Array<{ id: string; name: string; orgName?: string }> }>(`/api/users`);
        setUsers((res.items || []).map((u: any) => ({ id: u.id, name: u.name, orgName: u.orgName })));
      } catch {}
    })();
  }, []);

  function stripHtml(html: string) {
    const el = document.createElement('div');
    el.innerHTML = html || '';
    return (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
  }

  function isAllowedOneDriveUrl(raw: string) {
    try {
      const u = new URL(raw);
      const h = u.hostname.toLowerCase();
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      return h === '1drv.ms' || h === 'onedrive.live.com' || h.endsWith('.sharepoint.com') || h.endsWith('.sharepoint-df.com');
    } catch {
      return false;
    }
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

  function addAttachmentUrl() {
    const url = (attachUrl || '').trim();
    if (!url) return;
    if (!isAllowedOneDriveUrl(url)) {
      setError('원드라이브/SharePoint 링크만 첨부할 수 있습니다.');
      return;
    }
    setAttachments((prev) => [...prev, { url, name: url, filename: url }]);
    setAttachUrl('');
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!requesterId) { setError('로그인이 필요합니다.'); return; }
    const missing: string[] = [];
    if (!category) missing.push('카테고리');
    if (!teamName) missing.push('팀명');
    if (!title) missing.push('제목');
    if (!stripHtml(contentHtml)) missing.push('내용');
    if (missing.length) { setError(`${missing.join(', ')} 입력이 필요합니다.`); return; }
    setLoading(true);
    setError(null);
    setOkMsg('');
    try {
      const resWl = await apiJson<{ id: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({
            userId: requesterId,
            teamName,
            taskName: title || 'Help Request',
            title,
            content: stripHtml(contentHtml),
            contentHtml: contentHtml || undefined,
            attachments: { files: attachments },
          }),
        }
      );
      const worklogId = resWl.id;
      const body: any = { category, requesterId };
      if (queue) body.queue = queue;
      if (assigneeId) body.assigneeId = assigneeId;
      if (slaMinutes) body.slaMinutes = Number(slaMinutes) || 0;
      if (worklogId) body.worklogId = worklogId;
      if (dueDate) body.dueAt = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? `${dueDate}T00:00:00+09:00` : dueDate;
      const res = await apiJson<any>('/api/help-tickets', { method: 'POST', body: JSON.stringify(body) });
      setOkMsg(`요청 생성: ${res?.id || ''}`);
      // If invoked from a process task, complete it with cooperationId
      const linkage = selectedTask || (processInstanceId && taskInstanceId ? { instanceId: processInstanceId, taskId: taskInstanceId } : null);
      if (linkage && res?.id) {
        try {
          await apiJson(`/api/processes/${encodeURIComponent(linkage.instanceId)}/tasks/${encodeURIComponent(linkage.taskId)}/complete`, {
            method: 'POST',
            body: JSON.stringify({ cooperationId: res.id }),
          });
        } catch {}
      }
      setQueue('');
      setAssigneeId('');
      setSlaMinutes('');
      setTitle('');
      setDueDate('');
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
    <div style={{ display: 'grid', gap: 12, maxWidth: 740, margin: '24px auto' }}>
      {requesterId ? null : <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {okMsg && <div style={{ color: '#0F3D73' }}>{okMsg}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        <h3>프로세스 협조 대상 (선택)</h3>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gap: 8 }}>
          {(procTasks || []).map((t: any) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <b>{t.instance?.title || '-'}</b>
                <span style={{ marginLeft: 8, color: '#64748b' }}>{t.stageLabel ? `· ${t.stageLabel}` : ''}</span>
                <div style={{ fontSize: 12, color: '#334155' }}>{t.name}</div>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setSelectedTask({ instanceId: t.instance?.id, taskId: t.id })}>
                {selectedTask?.taskId === t.id ? '선택됨' : '선택'}
              </button>
            </div>
          ))}
          {!procTasks.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>현재 협조 대상 프로세스 과제가 없습니다.</div>}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <label>팀</label>
          <select value={teamName} onChange={(e) => setTeamName(e.target.value)} style={input}>
            {teams.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <label>제목</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
          <div className="resp-2">
            <label>
              담당자(선택)
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={input}>
                <option value="">선택 안함</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
                ))}
              </select>
            </label>
            <label>
              요청 기한(선택)
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={input} />
            </label>
          </div>
          <label>내용</label>
          <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
            <div ref={editorEl} style={{ minHeight: 240, width: '100%' }} />
          </div>
          <label>첨부 파일</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              placeholder="클라우드 파일 URL"
              value={attachUrl}
              onChange={(e) => setAttachUrl(e.target.value)}
              style={{ ...input, flex: 1 }}
            />
            <button type="button" className="btn btn-outline" onClick={addAttachmentUrl}>추가</button>
          </div>
          {attachments.length > 0 && (
            <div className="attachments">
              {attachments.map((f, i) => (
                <div key={`${f.url}-${i}`} className="attachment-item" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a className="file-link" href={f.url} target="_blank" rel="noreferrer">{f.name || f.url}</a>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => removeAttachment(i)}>삭제</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <label>카테고리</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} style={input} />
        <label>할당 큐(선택)</label>
        <input value={queue} onChange={(e) => setQueue(e.target.value)} style={input} />
        <label>SLA 분(선택)</label>
        <input type="number" value={slaMinutes} onChange={(e) => setSlaMinutes(e.target.value)} style={input} />
        <button onClick={submit} disabled={!requesterId || loading} style={primaryBtn}>{loading ? '요청중…' : '협조 요청'}</button>
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
