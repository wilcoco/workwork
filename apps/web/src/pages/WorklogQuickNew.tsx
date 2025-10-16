import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { uploadFile, uploadFiles, type UploadResp } from '../lib/upload';
import '../styles/editor.css';

export function WorklogQuickNew() {
  const nav = useNavigate();
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [teamName, setTeamName] = useState<string>('');
  const [taskName, setTaskName] = useState('');
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [attachments, setAttachments] = useState<UploadResp[]>([]);
  const quillRef = useRef<ReactQuill | null>(null);
  const [plainMode, setPlainMode] = useState(false);
  const [contentPlain, setContentPlain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('teamName') || '';
    if (stored) setTeamName(stored);
  }, []);

  function stripHtml(html: string) {
    const el = document.createElement('div');
    el.innerHTML = html || '';
    return (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const userId = localStorage.getItem('userId') || '';
      if (!userId) throw new Error('로그인이 필요합니다');
      const res = await apiJson<{ id: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({
            userId,
            teamName,
            taskName,
            title,
            content: plainMode ? contentPlain : stripHtml(contentHtml),
            contentHtml: plainMode ? undefined : (contentHtml || undefined),
            attachments: { files: attachments },
            date,
          }),
        }
      );
      nav(`/worklogs/${res.id}`);
    } catch (err: any) {
      setError(err?.message || '저장 실패');
    } finally {
      setLoading(false);
    }
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
        const editor = !plainMode ? quillRef.current?.getEditor() : null;
        const range = editor?.getSelection?.(true);
        if (editor && range) {
          editor.insertEmbed(range.index, 'image', up.url, 'user');
          editor.setSelection(range.index + 1, 0, 'user');
        } else if (editor) {
          editor.insertEmbed(0, 'image', up.url, 'user');
        } else {
          setContentPlain((prev) => (prev ? prev + '\n' + up.url : up.url));
        }
        setAttachments((prev) => [...prev, up]);
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
      e.target.value = '';
    } catch (e: any) {
      setError(e?.message || '파일 업로드 실패');
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760, margin: '24px auto' }}>
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 16, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: '#f3f4f6', display: 'grid', placeItems: 'center', fontWeight: 700 }}>🙂</div>
          <div style={{ color: '#6b7280', fontSize: 14 }}>무엇을 진행하셨나요?</div>
        </div>
        {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} required />
            <input placeholder="팀명" value={teamName} onChange={(e) => setTeamName(e.target.value)} style={input} required />
          </div>
          <input placeholder="과제명" value={taskName} onChange={(e) => setTaskName(e.target.value)} style={input} required />
          <input placeholder="업무일지 제목" value={title} onChange={(e) => setTitle(e.target.value)} style={input} required />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              본문 작성 {plainMode ? '(텍스트 모드)' : '(리치 모드)'}
            </div>
            <button type="button" style={smallBtn} onClick={() => setPlainMode((v) => !v)}>
              {plainMode ? '리치 모드' : '텍스트 모드'}
            </button>
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4 }}>
            {plainMode ? (
              <textarea
                value={contentPlain}
                onChange={(e) => setContentPlain(e.target.value)}
                placeholder="텍스트로 업무 내용을 입력하세요."
                style={{ ...input, minHeight: 200, resize: 'vertical' }}
              />)
              : (
              <ReactQuill
                ref={quillRef}
                theme="snow"
                value={contentHtml}
                onChange={setContentHtml}
                placeholder="업무 내용을 입력하고, 이미지 버튼으로 그림을 업로드하세요."
                style={{ height: 260 }}
                modules={{
                  toolbar: {
                    container: [
                      [{ header: [1, 2, 3, false] }],
                      ['bold', 'italic', 'underline', 'strike'],
                      [{ list: 'ordered' }, { list: 'bullet' }],
                      ['link', 'image'],
                      [{ color: [] }, { background: [] }],
                      [{ align: [] }],
                      ['clean'],
                    ],
                    handlers: {
                      image: onImageUpload,
                    },
                  },
                }}
              />
            )}
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
            <label style={{ fontSize: 13, color: '#6b7280' }}>첨부 파일</label>
            <input type="file" multiple onChange={onAttachFiles} />
            {attachments.length > 0 && (
              <div style={{ display: 'grid', gap: 6 }}>
                {attachments.map((f, i) => (
                  <div key={f.filename + i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <a href={f.url} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>{f.name}</a>
                    <button type="button" style={smallBtn} onClick={() => removeAttachment(i)}>삭제</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" style={ghostBtn} onClick={() => { setTitle(''); setContentHtml(''); setContentPlain(''); setPlainMode(false); setAttachments([]); }}>
              초기화
            </button>
            <button style={primaryBtn} disabled={loading}>
              {loading ? '작성중…' : '작성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  background: '#fff',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#111827',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#111827',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const smallBtn: React.CSSProperties = {
  background: '#ef4444',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  padding: '4px 8px',
  fontSize: 12,
  cursor: 'pointer',
};
