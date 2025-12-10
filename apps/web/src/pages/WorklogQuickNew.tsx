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
  const [date, setDate] = useState<string>(() => todayKstYmd());
  const [teamName, setTeamName] = useState<string>('');
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [teamTasks, setTeamTasks] = useState<Array<{ id: string; title: string; initTitle?: string; objTitle?: string; krTitle?: string; isKpi?: boolean; period: string; startAt?: string; krId?: string; krTarget?: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }>>([]);
  const [teamKpis, setTeamKpis] = useState<Array<{ id: string; title: string; krTarget?: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }>>([]);
  const [myTasks, setMyTasks] = useState<Array<{ id: string; title: string; initTitle?: string; objTitle?: string; krTitle?: string; isKpi?: boolean; period: string; startAt?: string; krId?: string; krTarget?: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }>>([]);
  const [selection, setSelection] = useState<string>(''); // 'init:<id>'
  const [krValue, setKrValue] = useState<string>('');
  const [initiativeDone, setInitiativeDone] = useState<boolean>(false);
  const [krAchieved, setKrAchieved] = useState<boolean>(false);
  const [urgent, setUrgent] = useState<boolean>(false);
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [attachments, setAttachments] = useState<UploadResp[]>([]);
  const quillRef = useRef<Quill | null>(null);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const [plainMode, setPlainMode] = useState(false);
  const [contentPlain, setContentPlain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'>('ALL');

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
          const meta: Record<string, { objTitle: string; krTitle: string; isKpi: boolean; krTarget: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }> = {};
          for (const o of (mokrs.items || [])) {
            for (const kr of (o.keyResults || [])) {
              meta[kr.id] = { objTitle: o.title, krTitle: kr.title, isKpi: !!o.pillar, krTarget: typeof kr.target === 'number' ? kr.target : null, krUnit: kr.unit, krBaseline: (typeof kr.baseline === 'number' ? kr.baseline : null), krDirection: (kr as any)?.direction };
            }
          }
          const its = (mine.items || []).map((ii: any) => {
            const s0 = ii.startAt ? new Date(ii.startAt) : null;
            const e0 = ii.endAt ? new Date(ii.endAt) : null;
            const s = s0 ? `${s0.getFullYear()}-${String(s0.getMonth()+1).padStart(2,'0')}-${String(s0.getDate()).padStart(2,'0')}` : '';
            const e = e0 ? `${e0.getFullYear()}-${String(e0.getMonth()+1).padStart(2,'0')}-${String(e0.getDate()).padStart(2,'0')}` : '';
            const pc = (s || e) ? ` (${s}${s || e ? ' ~ ' : ''}${e})` : '';
            const mm = meta[ii.keyResultId as string];
            const initTitle = (() => {
              const parts = String(ii.title || '').split('/');
              return (parts.length > 1 ? parts[parts.length - 1] : ii.title) as string;
            })();
            const title = (ii.title as string);
            return { id: ii.id, title, initTitle, objTitle: mm?.objTitle, krTitle: mm?.krTitle, isKpi: mm?.isKpi, period: pc, startAt: s, krId: ii.keyResultId, krTarget: mm?.krTarget ?? null, krUnit: mm?.krUnit, krBaseline: mm?.krBaseline ?? null, krDirection: mm?.krDirection };
          });
          setMyTasks(its);
        } catch {}
        // Load KPIs where I am explicitly assigned as participant (team KPI 포함)
        const res = await apiJson<{ items: any[] }>(`/api/okrs/my-kpis?userId=${encodeURIComponent(uid)}`);
        const objs = res.items || [];
        const tasks: Array<{ id: string; title: string; initTitle?: string; objTitle?: string; krTitle?: string; isKpi?: boolean; period: string; startAt?: string; krId?: string; krTarget?: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }> = [];
        const kpis: Array<{ id: string; title: string; krTarget?: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }> = [];
        for (const o of objs) {
          for (const kr of (o.keyResults || [])) {
            if (o.pillar) {
              kpis.push({ id: kr.id, title: `${o.title} / KPI: ${kr.title}`, krTarget: (typeof kr.target === 'number' ? kr.target : null), krUnit: kr.unit, krBaseline: (typeof kr.baseline === 'number' ? kr.baseline : null), krDirection: (kr as any)?.direction });
            }
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
                  const initTitle = String(ch.title || '');
                  tasks.push({ id: ch.id, title: initTitle, initTitle, objTitle: o.title, krTitle: kr.title, isKpi: !!o.pillar, period: pc, startAt: s, krId: kr.id, krTarget: (typeof kr.target === 'number' ? kr.target : null), krUnit: kr.unit, krBaseline: (typeof kr.baseline === 'number' ? kr.baseline : null), krDirection: (kr as any)?.direction });
                }
              }
            }
          }
        }
        setTeamTasks(tasks);
        setTeamKpis(kpis);
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
      if (!selection || !(selection.startsWith('init:') || selection.startsWith('kr:'))) throw new Error('대상을 선택하세요');
      const wl = await apiJson<{ id: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({
            userId,
            teamName,
            initiativeId: selection.startsWith('init:') ? selection.substring(5) : undefined,
            keyResultId: selection.startsWith('kr:') ? selection.substring(3) : undefined,
            taskName: selection.startsWith('kr:') ? (title || 'KPI 보고') : undefined,
            title,
            content: plainMode ? contentPlain : stripHtml(contentHtml),
            contentHtml: plainMode ? undefined : (contentHtml || undefined),
            attachments: { files: attachments },
            date,
            urgent,
            visibility,
          }),
        }
      );
      const isKR = selection.startsWith('kr:');
      const selectedId = isKR ? selection.substring(3) : selection.substring(5);
      const selected = isKR ? undefined : [...teamTasks, ...myTasks].find((x) => x.id === selectedId);
      // Progress: initiative done
      if (!isKR && initiativeDone) {
        await apiJson('/api/progress', {
          method: 'POST',
          body: JSON.stringify({ subjectType: 'INITIATIVE', subjectId: selectedId, actorId: userId, worklogId: wl.id, initiativeDone: true, note: title || undefined, at: date }),
        });
      }
      // Progress: KR value (explicit or achieved)
      if ((isKR || selected?.krId) && (krValue !== '' || krAchieved)) {
        let valueToSend: number | null = null;
        if (krValue !== '') {
          valueToSend = Number(krValue);
        } else if (krAchieved) {
          const tgt = isKR
            ? (teamKpis.find((k) => k.id === selectedId)?.krTarget ?? null)
            : (typeof selected!.krTarget === 'number' ? selected!.krTarget : null);
          if (tgt != null) valueToSend = tgt;
        }
        if (valueToSend != null) {
          await apiJson('/api/progress', {
            method: 'POST',
            body: JSON.stringify({ subjectType: 'KR', subjectId: isKR ? selectedId : (selected as any).krId, actorId: userId, worklogId: wl.id, krValue: valueToSend, note: title || undefined, at: date }),
          });
        }
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
            <label style={{ fontSize: 13, color: '#6b7280' }}>OKR 과제 / KPI 과제</label>
            <select value={selection} onChange={(e) => {
              const v = e.target.value;
              setSelection(v);
              // Keep current date as-is (default is today in KST)
            }} style={{ ...input, appearance: 'auto' as any }} required>
              <option value="" disabled>대상을 선택하세요</option>
              <optgroup label="OKR 과제">
                {(() => {
                  const kpiKrIds = new Set(teamKpis.map((k) => k.id));
                  const list = myTasks.filter((t) => !t.krId || !kpiKrIds.has(t.krId));
                  return list.map((t) => {
                    const initLabel = String(t.initTitle || (() => { const parts = String(t.title||'').split('/'); return parts.length>1? parts[parts.length-1].trim() : (t.title||''); })());
                    const prefix = `${t.objTitle || ''} / ${(t.isKpi ? 'KPI' : 'KR')}: ${t.krTitle || ''}`.trim();
                    return (
                      <option key={`init-${t.id}`} value={`init:${t.id}`}>{prefix} / {initLabel}</option>
                    );
                  });
                })()}
              </optgroup>
              <optgroup label="KPI 과제">
                {teamKpis.length ? (
                  teamKpis.flatMap((k) => {
                    const options: JSX.Element[] = [];
                    const allTasks = [...teamTasks, ...myTasks];
                    const seen = new Set<string>();
                    for (const t of allTasks) {
                      if (t.krId === k.id && !seen.has(t.id)) {
                        seen.add(t.id);
                        const initLabel = String(t.initTitle || (() => { const parts = String(t.title||'').split('/'); return parts.length>1? parts[parts.length-1].trim() : (t.title||''); })());
                        const prefix = `${t.objTitle || ''} / KPI: ${t.krTitle || ''}`.trim();
                        options.push(
                          <option key={`init-${t.id}`} value={`init:${t.id}`}>{prefix} / {initLabel}</option>
                        );
                      }
                    }
                    return options;
                  })
                ) : null}
              </optgroup>
            </select>
          </div>
          <input placeholder="업무일지 제목" value={title} onChange={(e) => setTitle(e.target.value)} style={input} required />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} style={{ width: 16, height: 16 }} /> 긴급 보고
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={initiativeDone} onChange={(e) => setInitiativeDone(e.target.checked)} style={{ width: 16, height: 16 }} /> 과제 완료
            </label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as any)}
              style={{ ...input, width: 'auto', paddingInline: 10 }}
            >
              <option value="ALL">조회 권한: 전체</option>
              <option value="MANAGER_PLUS">조회 권한: 팀장이상</option>
              <option value="EXEC_PLUS">조회 권한: 임원이상</option>
              <option value="CEO_ONLY">조회 권한: 대표이사</option>
            </select>
          </div>
          {(() => {
            if (!selection) return null;
            const isKR = selection.startsWith('kr:');
            const id = isKR ? selection.substring(3) : selection.substring(5);
            let meta: { baseline?: number | null; target?: number | null; unit?: string; direction?: 'AT_LEAST' | 'AT_MOST' } | null = null;
            if (isKR) {
              const k = teamKpis.find((x) => x.id === id);
              if (k) meta = { baseline: k.krBaseline ?? null, target: k.krTarget ?? null, unit: k.krUnit, direction: k.krDirection };
            } else {
              const t = [...teamTasks, ...myTasks].find((x) => x.id === id);
              if (t) meta = { baseline: t.krBaseline ?? null, target: t.krTarget ?? null, unit: t.krUnit, direction: t.krDirection };
            }
            if (!meta) return null;
            const dirLabel = meta.direction === 'AT_MOST' ? '이하 (≤ 목표가 좋음)' : '이상 (≥ 목표가 좋음)';
            const inputDisabled = (() => {
              if (!selection) return true;
              if (isKR) return myRole !== 'MANAGER';
              const sId = id;
              const mine = myTasks.some((x) => x.id === sId);
              const team = teamTasks.some((x) => x.id === sId);
              if (mine) return false;
              if (team) return myRole !== 'MANAGER';
              return true;
            })();
            const achievedDisabled = inputDisabled;
            return (
              <div className="card" style={{ padding: 10, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#334155', fontSize: 13 }}>
                  <div>기준값: {meta.baseline == null ? '-' : meta.baseline}</div>
                  <div>목표값: {meta.target == null ? '-' : meta.target}{meta.unit ? ` ${meta.unit}` : ''}</div>
                  <div>기준: {dirLabel}</div>
                </div>
                <div className="resp-2">
                  <label>
                    달성값 입력(선택)
                    <input type="number" step="any" value={krValue} onChange={(e) => setKrValue(e.target.value)} style={input} placeholder="예: 12.5" disabled={inputDisabled} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={krAchieved} onChange={(e) => setKrAchieved(e.target.checked)} disabled={achievedDisabled} /> 목표 달성으로 기록(목표값 자동 입력)
                  </label>
                </div>
              </div>
            );
          })()}
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

 
