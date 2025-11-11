import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';
import { UserPicker, type PickedUser } from '../components/UserPicker';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile, uploadFiles, type UploadResp } from '../lib/upload';
import '../styles/editor.css';

export function CoopsRequest() {
  const [category, setCategory] = useState('General');
  const [queue, setQueue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [slaMinutes, setSlaMinutes] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState('');
  const [createNewDoc, setCreateNewDoc] = useState(true);
  const [teamName, setTeamName] = useState<string>(() => (typeof localStorage !== 'undefined' ? (localStorage.getItem('teamName') || '') : ''));
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [attachments, setAttachments] = useState<UploadResp[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);

  const requesterId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  function onPick(u: PickedUser) {
    setAssigneeId(u.id);
    setAssigneeName(u.name);
    setShowPicker(false);
  }

  useEffect(() => {
    if (!createNewDoc) return;
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
    quillRef.current = q;
  }, [createNewDoc]);

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
    if (!requesterId) { setError('로그인이 필요합니다.'); return; }
    const missing: string[] = [];
    if (!category) missing.push('카테고리');
    if (createNewDoc) {
      if (!teamName) missing.push('팀명');
      if (!title) missing.push('제목');
      if (!stripHtml(contentHtml)) missing.push('내용');
    }
    if (missing.length) { setError(`${missing.join(', ')} 입력이 필요합니다.`); return; }
    setLoading(true);
    setError(null);
    setOkMsg('');
    try {
      let worklogId: string | undefined;
      if (createNewDoc) {
        const res = await apiJson<{ id: string }>(
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
        worklogId = res.id;
      }
      const body: any = { category, requesterId };
      if (queue) body.queue = queue;
      if (assigneeId) body.assigneeId = assigneeId;
      if (slaMinutes) body.slaMinutes = Number(slaMinutes) || 0;
      if (worklogId) body.worklogId = worklogId;
      const res = await apiJson<any>('/api/help-tickets', { method: 'POST', body: JSON.stringify(body) });
      setOkMsg(`요청 생성: ${res?.id || ''}`);
      setQueue('');
      setAssigneeId('');
      setSlaMinutes('');
      setTitle('');
      setContentHtml('');
      setAttachments([]);
    } catch (e: any) {
      setError(e?.message || '요청 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 740, margin: '24px auto' }}>
      <h2 style={{ margin: 0 }}>업무 협조 요청</h2>
      {requesterId ? null : <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {okMsg && <div style={{ color: '#0F3D73' }}>{okMsg}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ margin: 0 }}>새 문서 작성</label>
          <input type="checkbox" checked={createNewDoc} onChange={(e) => setCreateNewDoc(e.target.checked)} />
        </div>
        {createNewDoc && (
          <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <label>팀</label>
            <select value={teamName} onChange={(e) => setTeamName(e.target.value)} style={input}>
              {teams.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <label>제목</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
            <label>내용</label>
            <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
              <div ref={editorEl} style={{ minHeight: 240, width: '100%' }} />
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
          </div>
        )}
        <label>카테고리</label>
        <input value={category} onChange={(e) => setCategory(e.target.value)} style={input} />
        <label>할당 큐(선택)</label>
        <input value={queue} onChange={(e) => setQueue(e.target.value)} style={input} />
        <label>담당자(선택)</label>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input placeholder="담당자 User ID(직접 입력)" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} style={input} />
            <button type="button" style={primaryBtn} onClick={() => setShowPicker(true)}>선택</button>
          </div>
          {assigneeName && <div style={{ fontSize: 12, color: '#64748b' }}>선택됨: {assigneeName} ({assigneeId})</div>}
          {showPicker && (
            <div>
              <UserPicker onSelect={onPick} onClose={() => setShowPicker(false)} />
            </div>
          )}
        </div>
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
