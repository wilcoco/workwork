import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import { uploadFile, uploadFiles, type UploadResp } from '../lib/upload';
import '../styles/editor.css';
import { todayKstYmd } from '../lib/time';

export function WorklogQuickNew() {
  const nav = useNavigate();
  function firstDayKstYmd() {
    const t = todayKstYmd();
    return t.slice(0, 8) + '01';
  }
  const [date, setDate] = useState<string>(() => firstDayKstYmd());
  const [teamName, setTeamName] = useState<string>('');
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [teamTasks, setTeamTasks] = useState<Array<{ id: string; title: string; period: string; startAt?: string; krId?: string }>>([]);
  const [myTasks, setMyTasks] = useState<Array<{ id: string; title: string; period: string; startAt?: string; krId?: string }>>([]);
  const [selection, setSelection] = useState<string>(''); // 'init:<id>'
  const [krValue, setKrValue] = useState<string>('');
  const [initiativeDone, setInitiativeDone] = useState<boolean>(false);
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [attachments, setAttachments] = useState<UploadResp[]>([]);
  const quillRef = useRef<Quill | null>(null);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const [plainMode, setPlainMode] = useState(false);
  const [contentPlain, setContentPlain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('teamName') || '';
    if (stored) setTeamName(stored);
    const uid = localStorage.getItem('userId') || '';
    if (!uid) return;
    (async () => {
      try {
        const me = await apiJson<{ id: string; orgUnitId: string; role?: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' }>(`/api/users/me?userId=${encodeURIComponent(uid)}`);
        const ou = me.orgUnitId || '';
        setOrgUnitId(ou);
        setMyRole((me as any)?.role || '');
        // Always load my own initiatives (personal OKR/KPI tasks) and enrich with my OKR metadata (O/KR)
        try {
          const mine = await apiJson<{ items: any[] }>(`/api/initiatives/my?userId=${encodeURIComponent(uid)}`);
          const mokrs = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(uid)}`);
          const meta: Record<string, { objTitle: string; krTitle: string }> = {};
          for (const o of (mokrs.items || [])) {
            for (const kr of (o.keyResults || [])) {
              meta[kr.id] = { objTitle: o.title, krTitle: kr.title };
            }
          }
          const its = (mine.items || []).map((ii: any) => {
            const s0 = ii.startAt ? new Date(ii.startAt) : null;
            const e0 = ii.endAt ? new Date(ii.endAt) : null;
            const s = s0 ? `${s0.getFullYear()}-${String(s0.getMonth()+1).padStart(2,'0')}-${String(s0.getDate()).padStart(2,'0')}` : '';
            const e = e0 ? `${e0.getFullYear()}-${String(e0.getMonth()+1).padStart(2,'0')}-${String(e0.getDate()).padStart(2,'0')}` : '';
            const pc = (s || e) ? ` (${s}${s || e ? ' ~ ' : ''}${e})` : '';
            const mm = meta[ii.keyResultId as string];
            const title = mm ? `${mm.objTitle} / KR: ${mm.krTitle} / ${ii.title}` : (ii.title as string);
            return { id: ii.id, title, period: pc, startAt: s, krId: ii.keyResultId };
          });
          setMyTasks(its);
        } catch {}
        if (!ou) return;
        const res = await apiJson<{ items: any[] }>(`/api/okrs/objectives?orgUnitId=${encodeURIComponent(ou)}`);
        const objs = res.items || [];
        const tasks: Array<{ id: string; title: string; period: string; startAt?: string; krId?: string }> = [];
        for (const o of objs) {
          for (const kr of (o.keyResults || [])) {
            for (const ii of (kr.initiatives || [])) {
              if (Array.isArray(ii.children)) {
                for (const ch of ii.children) {
                  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
                  const lastDay = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                  const s0 = ch.startAt ? new Date(ch.startAt) : null;
                  const e0 = ch.endAt ? new Date(ch.endAt) : null;
                  let sD = s0;
                  if (s0) {
                    const sNext = addDays(s0, 1);
                    if (s0.getDate() >= 28 && sNext.getDate() === 1) sD = sNext;
                  }
                  let eD = e0;
                  if (e0) {
                    const eNext = addDays(e0, 1);
                    if (e0.getDate() >= 28 && eNext.getDate() === lastDay(eNext)) eD = eNext;
                  }
                  const s = sD ? `${sD.getFullYear()}-${String(sD.getMonth()+1).padStart(2,'0')}-${String(sD.getDate()).padStart(2,'0')}` : '';
                  const e = eD ? `${eD.getFullYear()}-${String(eD.getMonth()+1).padStart(2,'0')}-${String(eD.getDate()).padStart(2,'0')}` : '';
                  const pc = (s || e) ? ` (${s}${s || e ? ' ~ ' : ''}${e})` : '';
                  tasks.push({ id: ch.id, title: `${o.title} / KR: ${kr.title} / ${ch.title}`, period: pc, startAt: s, krId: kr.id });
                }
              }
            }
          }
        }
        setTeamTasks(tasks);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (plainMode) return; // don't init in plain mode
    if (!editorEl.current) return;
    if (quillRef.current) return; // already initialized
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
          handlers: {
            image: onImageUpload,
          },
        },
      },
      placeholder: '업무 내용을 입력하고, 이미지 버튼으로 그림을 업로드하세요.',
    } as any);
    q.on('text-change', () => {
      setContentHtml(q.root.innerHTML);
    });
    quillRef.current = q;
  }, [plainMode]);

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
      if (!selection || !selection.startsWith('init:')) throw new Error('과제를 선택하세요');
      const wl = await apiJson<{ id: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({
            userId,
            teamName,
            initiativeId: selection.substring(5),
            title,
            content: plainMode ? contentPlain : stripHtml(contentHtml),
            contentHtml: plainMode ? undefined : (contentHtml || undefined),
            attachments: { files: attachments },
            date,
          }),
        }
      );
      const selectedId = selection.substring(5);
      const selected = [...teamTasks, ...myTasks].find((x) => x.id === selectedId);
      // Progress: initiative done
      if (initiativeDone) {
        await apiJson('/api/progress', {
          method: 'POST',
          body: JSON.stringify({ subjectType: 'INITIATIVE', subjectId: selectedId, actorId: userId, worklogId: wl.id, initiativeDone: true, note: title || undefined, at: date }),
        });
      }
      // Progress: KR value
      if (selected?.krId && krValue !== '') {
        await apiJson('/api/progress', {
          method: 'POST',
          body: JSON.stringify({ subjectType: 'KR', subjectId: selected.krId, actorId: userId, worklogId: wl.id, krValue: Number(krValue), note: title || undefined, at: date }),
        });
      }
      nav('/search?mode=list');
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
        const editor = !plainMode ? quillRef.current : null;
        const range = editor?.getSelection?.(true);
        if (editor && range) {
          editor.insertEmbed(range.index, 'image', up.url, 'user');
          editor.setSelection(range.index + 1, 0, 'user');
        } else if (editor) {
          editor.insertEmbed(0, 'image', up.url, 'user');
        } else {
          setContentPlain((prev) => (prev ? prev + '\n' + up.url : up.url));
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
      e.target.value = '';
    } catch (e: any) {
      setError(e?.message || '파일 업로드 실패');
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 760, margin: '24px auto' }}>
      <div className="card elevated accent">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, color: '#475569' }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: '#f3f4f6', display: 'grid', placeItems: 'center', fontWeight: 700 }}>🙂</div>
          <div style={{ color: '#6b7280', fontSize: 14 }}>무엇을 진행하셨나요?</div>
        </div>
        {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
        <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <div className="resp-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} required />
            <input placeholder="팀명" value={teamName} onChange={(e) => setTeamName(e.target.value)} style={input} required />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, color: '#6b7280' }}>나의 과제</label>
            <select value={selection} onChange={(e) => {
              const v = e.target.value;
              setSelection(v);
              const id = v.startsWith('init:') ? v.substring(5) : '';
              const t = [...teamTasks, ...myTasks].find((x) => x.id === id);
              if (t?.startAt) {
                const y = t.startAt.slice(0,4);
                const m = t.startAt.slice(5,7);
                setDate(`${y}-${m}-01`);
              } else {
                setDate(firstDayKstYmd());
              }
            }} style={{ ...input, appearance: 'auto' as any }} required>
              <option value="" disabled>과제를 선택하세요</option>
              {(() => {
                const list = [...teamTasks, ...myTasks];
                const uniq: Array<{ id: string; title: string; period: string; startAt?: string }> = [];
                const seen = new Set<string>();
                for (const t of list) { if (!seen.has(t.id)) { seen.add(t.id); uniq.push(t); } }
                return uniq.length ? (
                  uniq.map((t) => (
                    <option key={t.id} value={`init:${t.id}`}>{t.title}{t.period}</option>
                  ))
                ) : (
                  <option value="" disabled>나의 OKR/KPI 과제가 없습니다</option>
                );
              })()}
            </select>
          </div>
          <input placeholder="업무일지 제목" value={title} onChange={(e) => setTitle(e.target.value)} style={input} required />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>
              본문 작성 {plainMode ? '(텍스트 모드)' : '(리치 모드)'}
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setPlainMode((v) => !v)}>
              {plainMode ? '리치 모드' : '텍스트 모드'}
            </button>
          </div>
          <div className="quill-box" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 4, overflow: 'hidden' }}>
            {plainMode ? (
              <textarea
                value={contentPlain}
                onChange={(e) => setContentPlain(e.target.value)}
                placeholder="텍스트로 업무 내용을 입력하세요."
                style={{ ...input, minHeight: 200, resize: 'vertical' }}
              />
            ) : (
              <div ref={editorEl} style={{ minHeight: 260, width: '100%' }} />
            )}
          </div>
          <div className="resp-2" style={{ marginTop: 6 }}>
            <label>
              지표값 입력(선택)
              <input type="number" step="any" value={krValue} onChange={(e) => setKrValue(e.target.value)} style={input} placeholder="예: 12.5" disabled={(() => {
                const id = selection.startsWith('init:') ? selection.substring(5) : '';
                const mine = myTasks.some((x) => x.id === id);
                const team = teamTasks.some((x) => x.id === id);
                if (mine) return false; // own OKR allowed
                if (team) return myRole !== 'MANAGER'; // team KPI only for manager
                return true;
              })()} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={initiativeDone} onChange={(e) => setInitiativeDone(e.target.checked)} /> 과제 완료
            </label>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
            <label style={{ fontSize: 13, color: '#6b7280' }}>첨부 파일</label>
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
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => { setTitle(''); setContentHtml(''); setContentPlain(''); setPlainMode(false); setAttachments([]); }}>
              초기화
            </button>
            <button className="btn btn-primary" disabled={loading}>
              {loading ? '작성중…' : '작성'}
            </button>
          </div>
        </form>
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

 
