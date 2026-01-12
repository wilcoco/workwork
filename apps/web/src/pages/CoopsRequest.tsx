import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile } from '../lib/upload';
import '../styles/editor.css';
import { DocumentTags, DocumentTagsValue } from '../components/DocumentTags';

export function CoopsRequest() {
  const [category, setCategory] = useState('General');
  const [queue, setQueue] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string>('');
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
  const [teams, setTeams] = useState<string[]>([]);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const [attachOneDriveOk, setAttachOneDriveOk] = useState<boolean>(false);
  const [tags, setTags] = useState<DocumentTagsValue>({});

  const requesterId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  useEffect(() => {
    if (!editorEl.current) return;
    if (quillRef.current) return;
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
    const q = new Quill(editorEl.current, {
      theme: 'snow',
      modules: {
        toolbar: {
          container: toolbar,
          handlers: { image: onImageUpload },
        },
      },
      placeholder: '업무 요청 내용을 입력하고, 이미지 버튼으로 그림을 업로드하세요.',
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

  async function addAttachmentFiles(list: FileList | null) {
    const files = Array.from(list || []);
    if (!files.length) return;
    try {
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        const up = await uploadFile(f);
        setAttachments((prev) => [...prev, { url: up.url, name: up.name || f.name, filename: up.filename || f.name }]);
      }
    } catch (e: any) {
      setError(e?.message || '첨부 파일 업로드 실패');
    }
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
      if (slaMinutes) body.slaMinutes = Number(slaMinutes) || 0;
      if (worklogId) body.worklogId = worklogId;
      if (dueDate) body.dueAt = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? `${dueDate}T00:00:00+09:00` : dueDate;
      if (tags.itemCode || tags.moldCode || tags.carModelCode || tags.supplierCode) body.tags = tags;
      // 복수 담당자에게 각각 요청 생성
      const createdIds: string[] = [];
      if (assigneeIds.length > 0) {
        for (const aid of assigneeIds) {
          const ticketBody = { ...body, assigneeId: aid };
          const res = await apiJson<any>('/api/help-tickets', { method: 'POST', body: JSON.stringify(ticketBody) });
          if (res?.id) createdIds.push(res.id);
        }
      } else {
        // 담당자 미지정 시 하나만 생성
        const res = await apiJson<any>('/api/help-tickets', { method: 'POST', body: JSON.stringify(body) });
        if (res?.id) createdIds.push(res.id);
      }
      setOkMsg(`요청 생성 완료: ${createdIds.length}건`);
      setQueue('');
      setAssigneeIds([]);
      setSlaMinutes('');
      setTitle('');
      setDueDate('');
      setContentHtml('');
      setAttachments([]);
      setTags({});
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
        <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          {teamName && (
            <div style={{ fontSize: 12, color: '#64748b' }}>요청자 소속: <b>{teamName}</b></div>
          )}
          <label>제목</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />
          <div style={{ display: 'grid', gap: 8 }}>
            <label>담당자 (복수 선택 가능)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                value={selectedTeamFilter}
                onChange={(e) => setSelectedTeamFilter(e.target.value)}
                style={{ ...input, flex: '0 0 auto', minWidth: 120 }}
              >
                <option value="">전체 팀</option>
                {teams.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select
                value=""
                onChange={(e) => {
                  const uid = e.target.value;
                  if (uid && !assigneeIds.includes(uid)) {
                    setAssigneeIds([...assigneeIds, uid]);
                  }
                }}
                style={{ ...input, flex: 1 }}
              >
                <option value="">담당자 추가...</option>
                {users
                  .filter((u) => !selectedTeamFilter || u.orgName === selectedTeamFilter)
                  .filter((u) => !assigneeIds.includes(u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
                  ))}
              </select>
            </div>
            {assigneeIds.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {assigneeIds.map((aid) => {
                  const u = users.find((x) => x.id === aid);
                  return (
                    <span
                      key={aid}
                      style={{
                        background: '#e0f2fe',
                        color: '#0369a1',
                        padding: '4px 8px',
                        borderRadius: 6,
                        fontSize: 13,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      {u?.name || aid}{u?.orgName ? ` · ${u.orgName}` : ''}
                      <button
                        type="button"
                        onClick={() => setAssigneeIds(assigneeIds.filter((x) => x !== aid))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#0369a1' }}
                      >
                        ✕
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {!assigneeIds.length && (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>담당자를 선택하지 않으면 미지정 상태로 요청됩니다.</div>
            )}
          </div>
          <label>
            요청 기한(선택)
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={input} />
          </label>
          <label>내용</label>
          <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
            <div ref={editorEl} style={{ minHeight: 240, width: '100%' }} />
          </div>
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
              className="btn btn-outline"
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
              className="btn btn-outline"
              onClick={() => window.open('https://office.com/launch/onedrive', '_blank', 'noopener,noreferrer')}
            >OneDrive 열기</button>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
            <input type="checkbox" checked={attachOneDriveOk} onChange={(e) => setAttachOneDriveOk(e.target.checked)} />
            원드라이브 파일만 업로드합니다
          </label>
          <div style={{ fontSize: 12, color: '#64748b' }}>원드라이브 파일만 올려주세요. (브라우저 제한으로 원드라이브 폴더를 자동으로 열 수는 없습니다)</div>
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
        <DocumentTags value={tags} onChange={setTags} compact />
        <button onClick={submit} disabled={!requesterId || loading} style={primaryBtn}>{loading ? '요청중…' : '업무 요청'}</button>
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
