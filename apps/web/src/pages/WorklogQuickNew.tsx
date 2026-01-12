import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { uploadFile } from '../lib/upload';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';
import '../styles/editor.css';
import { todayKstYmd } from '../lib/time';
import { BpmnMiniView } from '../components/BpmnMiniView';
import { toSafeHtml } from '../lib/richText';

export function WorklogQuickNew() {
  const nav = useNavigate();
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const processInstanceId = params?.get('processInstanceId') || '';
  const taskInstanceId = params?.get('taskInstanceId') || '';
  const [date, setDate] = useState<string>(() => todayKstYmd());
  const [teamName, setTeamName] = useState<string>('');
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | ''>('');
  const [teamTasks, setTeamTasks] = useState<Array<{ id: string; title: string; initTitle?: string; objTitle?: string; krTitle?: string; isKpi?: boolean; period: string; startAt?: string; krId?: string; krTarget?: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }>>([]);
  const [teamKpis, setTeamKpis] = useState<Array<{ id: string; title: string; krTarget?: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }>>([]);
  const [helpTickets, setHelpTickets] = useState<Array<{ id: string; label: string }>>([]);
  const [myTasks, setMyTasks] = useState<Array<{ id: string; title: string; initTitle?: string; objTitle?: string; krTitle?: string; isKpi?: boolean; period: string; startAt?: string; krId?: string; krTarget?: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST' }>>([]);
  const [selection, setSelection] = useState<string>(''); // 'init:<id>'
  const [krValue, setKrValue] = useState<string>('');
  const [initiativeDone, setInitiativeDone] = useState<boolean>(false);
  const [krAchieved, setKrAchieved] = useState<boolean>(false);
  const [urgent, setUrgent] = useState<boolean>(false);
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [attachments, setAttachments] = useState<Array<{ url: string; name?: string; filename?: string }>>([]);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const [attachOneDriveOk, setAttachOneDriveOk] = useState<boolean>(false);
  const quillRef = useRef<Quill | null>(null);
  const editorEl = useRef<HTMLDivElement | null>(null);
  const [plainMode, setPlainMode] = useState(false);
  const [contentPlain, setContentPlain] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY'>('ALL');
  const myUserId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [myProcTasks, setMyProcTasks] = useState<Array<{ id: string; name: string; description?: string; instance: { id: string; title: string } }>>([]);
  const [processDetailPopup, setProcessDetailPopup] = useState<any>(null);
  const [processDetailLoading, setProcessDetailLoading] = useState(false);

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
        const myId = me.id || uid;
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

        // Load 협조(HelpTicket) assigned to me and 이미 수락/진행 중인 것들만 노출
        try {
          const acc = await apiJson<{ items: any[] }>(`/api/help-tickets?assigneeId=${encodeURIComponent(myId)}&status=ACCEPTED`);
          const prog = await apiJson<{ items: any[] }>(`/api/help-tickets?assigneeId=${encodeURIComponent(myId)}&status=IN_PROGRESS`);
          const all = [...(acc.items || []), ...(prog.items || [])];
          const dedup: Record<string, any> = {};
          for (const t of all) dedup[t.id] = t;
          const tickets = Object.values(dedup).map((t: any) => {
            const who = t.requester?.name || '요청자 미상';
            const cat = t.category || '일반 협조';
            const helpTitle = t.helpTitle || '';
            const titlePart = helpTitle ? ` · ${helpTitle}` : '';
            // 협조 제목 중심으로 표시: 협조: [카테고리] · [협조제목] · [요청자]
            return { id: String(t.id), label: `협조: ${cat}${titlePart} · ${who}` };
          });
          setHelpTickets(tickets);
        } catch {}
      } catch {}
    })();
  }, []);

  // Load my process tasks for selection (only WORKLOG tasks). If opened from process inbox, preselect that task.
  useEffect(() => {
    (async () => {
      if (!myUserId) return;
      try {
        const tasks = await apiJson<Array<{ id: string; name: string; taskType: string; instance: { id: string; title: string } }>>(`/api/processes/inbox?assigneeId=${encodeURIComponent(myUserId)}`);
        const onlyWorklog = (tasks || []).filter((t) => String(t.taskType).toUpperCase() === 'WORKLOG');
        const filtered = processInstanceId ? onlyWorklog.filter((t) => t.instance?.id === processInstanceId) : onlyWorklog;
        setMyProcTasks(filtered as any);
        if (taskInstanceId && (!selection || selection === '')) {
          const exists = filtered.some((t) => t.id === taskInstanceId);
          if (exists) setSelection(`proc:${taskInstanceId}`);
        }
      } catch {}
    })();
  }, [myUserId, processInstanceId, taskInstanceId]);

  useEffect(() => {
    if (plainMode) return; // don't init in plain mode
    if (!editorEl.current) return;
    if (quillRef.current) return; // already initialized
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
    // robust paste/drop handlers on editor root
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
      } catch (err: any) {
        setError(err?.message || '이미지 업로드 실패');
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
          return;
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
      if (!selection || !(selection.startsWith('init:') || selection.startsWith('kr:') || selection.startsWith('help:') || selection.startsWith('proc:'))) throw new Error('대상을 선택하세요');
      const wl = await apiJson<{ id: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({
            userId,
            teamName,
            initiativeId: selection.startsWith('init:') ? selection.substring(5) : undefined,
            keyResultId: selection.startsWith('kr:') ? selection.substring(3) : undefined,
            // help: 선택 시에는 별도 링크 없이 일반 업무일지로만 기록
            // proc: 선택 시에는 내부적으로 OKR 스캐폴딩 하여 initiative 자동 생성 필요 → taskName을 제공
            taskName: selection.startsWith('kr:') ? (title || 'KPI 보고') : (selection.startsWith('proc:') ? (title || '프로세스 업무') : undefined),
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
      const isInit = selection.startsWith('init:');
      const isHelp = selection.startsWith('help:');
      const isProc = selection.startsWith('proc:');
      const selectedId = isKR ? selection.substring(3) : isInit ? selection.substring(5) : selection.substring(5);
      const selected = isInit ? [...teamTasks, ...myTasks].find((x) => x.id === selectedId) : undefined;
      // Progress: initiative done (help 선택 시에는 제외)
      if (isInit && initiativeDone) {
        await apiJson('/api/progress', {
          method: 'POST',
          body: JSON.stringify({ subjectType: 'INITIATIVE', subjectId: selectedId, actorId: userId, worklogId: wl.id, initiativeDone: true, note: title || undefined, at: date }),
        });
      }
      // Progress: KR value (explicit or achieved) — help 선택 시에는 KR가 없으므로 그대로 조건 유지
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
      // Help: 협조 선택으로 생성된 업무일지인 경우, 해당 HelpTicket을 협조 완료로 표시하고 대응 업무일지 링크를 저장한다.
      if (isHelp) {
        const ticketId = selectedId;
        await apiJson(`/api/help-tickets/${encodeURIComponent(ticketId)}/resolve`, {
          method: 'POST',
          body: JSON.stringify({ actorId: userId, worklogId: wl.id }),
        });
      }
      // If process task selected or coming from process inbox, link worklog to task
      if (isProc || taskInstanceId) {
        try {
          const tid = isProc ? selection.substring(5) : taskInstanceId;
          const t = myProcTasks.find((x) => x.id === tid);
          const pid = t?.instance?.id || processInstanceId;
          if (pid && tid) {
            await apiJson(`/api/processes/${encodeURIComponent(pid)}/tasks/${encodeURIComponent(tid)}/link-worklog`, {
              method: 'POST',
              body: JSON.stringify({ worklogId: wl.id }),
            });
            // If initiativeDone is checked, complete the process task
            if (initiativeDone) {
              await apiJson(`/api/processes/${encodeURIComponent(pid)}/tasks/${encodeURIComponent(tid)}/complete`, {
                method: 'POST',
                body: JSON.stringify({ actorId: userId }),
              });
            }
          }
        } catch {}
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
        try {
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
        } catch (e: any) {
          setError(e?.message || '이미지 업로드 실패');
        }
      };
      input.click();
    } catch (e: any) {
      setError(e?.message || '이미지 업로드 실패');
    }
  }

  async function openProcessDetail() {
    const isProc = selection.startsWith('proc:');
    const tid = isProc ? selection.substring(5) : taskInstanceId;
    const t = myProcTasks.find((x) => x.id === tid);
    const pid = t?.instance?.id || processInstanceId;
    console.log('openProcessDetail:', { isProc, tid, t, pid, selection, processInstanceId, myProcTasks });
    if (!pid) {
      alert('프로세스 ID를 찾을 수 없습니다.');
      return;
    }
    setProcessDetailLoading(true);
    try {
      const d = await apiJson<any>(`/api/processes/${encodeURIComponent(pid)}`);
      setProcessDetailPopup(d);
    } catch (err: any) {
      console.error('openProcessDetail error:', err);
      alert('프로세스 정보를 불러오지 못했습니다: ' + (err?.message || ''));
    } finally {
      setProcessDetailLoading(false);
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
            <label style={{ fontSize: 13, color: '#6b7280' }}>OKR 과제 / KPI 과제 / 협조 추가</label>
            <select value={selection} onChange={(e) => {
              const v = e.target.value;
              setSelection(v);
              // Keep current date as-is (default is today in KST)
            }} style={{ ...input, appearance: 'auto' as any }} required>
              <option value="" disabled>대상을 선택하세요</option>
              {myProcTasks.length > 0 && (
                <optgroup label="프로세스 과제">
                  {myProcTasks.map((t) => (
                    <option key={`proc-${t.id}`} value={`proc:${t.id}`}>프로세스: {t.instance?.title || ''} / {t.name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="OKR 과제">
                {(() => {
                  // OKR 과제에는 순수 OKR만 노출하고, KPI에 속한 과제와 결재/협조(Auto Objective) 과제는 모두 제외한다.
                  const list = myTasks.filter((t) => {
                    if (t.isKpi) return false;
                    const obj = String(t.objTitle || '');
                    if (obj.startsWith('Auto Objective')) return false;
                    return true;
                  });
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
              {helpTickets.length > 0 && (
                <optgroup label="협조 추가">
                  {helpTickets.map((t) => (
                    <option key={`help-${t.id}`} value={`help:${t.id}`}>{t.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {(selection.startsWith('proc:') || taskInstanceId) && (() => {
              const tid = selection.startsWith('proc:') ? selection.substring(5) : taskInstanceId;
              const selectedTask = myProcTasks.find((t) => t.id === tid);
              return (
                <div style={{ marginTop: 8 }}>
                  {selectedTask?.description && (
                    <div style={{ border: '2px solid #16a34a', borderRadius: 8, padding: 12, marginBottom: 8, background: '#f0fdf4' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#15803d', marginBottom: 6 }}>📋 과제 설명</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }} dangerouslySetInnerHTML={{ __html: toSafeHtml(selectedTask.description) }} />
                    </div>
                  )}
                  <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={openProcessDetail} disabled={processDetailLoading}>
                    {processDetailLoading ? '불러오는 중...' : '프로세스 상세 보기 (이전 업무일지 확인)'}
                  </button>
                </div>
              );
            })()}
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
            <div style={{ fontSize: 12, color: '#6b7280' }}>원드라이브 파일만 올려주세요. (브라우저 제한으로 원드라이브 폴더를 자동으로 열 수는 없습니다)</div>
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

      {processDetailPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={() => setProcessDetailPopup(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(900px, 95vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0 }}>프로세스 상세: {processDetailPopup.title}</h4>
              <button className="btn" onClick={() => setProcessDetailPopup(null)}>닫기</button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              상태: {processDetailPopup.status} · 시작: {processDetailPopup.startAt ? new Date(processDetailPopup.startAt).toLocaleDateString() : '-'}
            </div>
            <div style={{ display: 'grid', gap: 12 }}>
              {processDetailPopup.template?.description && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>프로세스 설명</div>
                  <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(processDetailPopup.template.description) }} />
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', background: '#f9fafb', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #e5e7eb' }}>업무 흐름도</div>
                  {processDetailPopup.template?.bpmnJson ? (
                    <div style={{ padding: 12 }}><BpmnMiniView bpmn={processDetailPopup.template.bpmnJson} height={400} /></div>
                  ) : (
                    <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>BPMN 정보가 없습니다.</div>
                  )}
                </div>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', background: '#f9fafb', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #e5e7eb' }}>노드별 설명</div>
                  <div style={{ padding: 12, maxHeight: 400, overflowY: 'auto' }}>
                    {(processDetailPopup.template?.tasks || []).length > 0 ? (
                      <div style={{ display: 'grid', gap: 10 }}>
                        {(processDetailPopup.template?.tasks || []).map((tt: any) => (
                          <div key={tt.id} style={{ border: '1px solid #eef2f7', borderRadius: 6, padding: 10 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                              <span style={{ fontWeight: 600 }}>{tt.name || '-'}</span>
                              <span style={{ fontSize: 11, color: '#6b7280', background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{tt.taskType}</span>
                            </div>
                            {tt.description ? (
                              <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(tt.description) }} />
                            ) : (
                              <div style={{ fontSize: 12, color: '#9ca3af' }}>설명 없음</div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>노드 정보가 없습니다.</div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ padding: '6px 8px', background: '#f9fafb', fontWeight: 700, fontSize: 12 }}>과제 진행 현황</div>
                {(() => {
                  const d = processDetailPopup;
                  const tmplTasks = ((d.template?.tasks || []) as any[]).slice().sort((a: any, b: any) => (Number(a.orderHint || 0) - Number(b.orderHint || 0)));
                  if (!tmplTasks.length) return <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>템플릿 태스크가 없습니다.</div>;
                  const seqMap = new Map<string, number>();
                  tmplTasks.forEach((t: any, idx: number) => seqMap.set(String(t.id), idx + 1));
                  const group = new Map<string, any[]>();
                  for (const t of (d.tasks || [])) {
                    const arr = group.get(t.taskTemplateId) || [];
                    arr.push(t);
                    group.set(t.taskTemplateId, arr);
                  }
                  const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '-');
                  return (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 1.6fr 1fr 3fr', padding: '6px 8px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #eef2f7' }}>
                        <div>#</div>
                        <div>단계/태스크</div>
                        <div>유형</div>
                        <div>담당 / 상태 / 업무일지</div>
                      </div>
                      {tmplTasks.map((tt: any) => {
                        const idx = seqMap.get(String(tt.id)) || 0;
                        const line = (group.get(tt.id) || []).slice().sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                        return (
                          <div key={tt.id} style={{ display: 'grid', gridTemplateColumns: '0.5fr 1.6fr 1fr 3fr', padding: '6px 8px', borderTop: '1px solid #eef2f7', fontSize: 12, alignItems: 'start' }}>
                            <div>{idx}</div>
                            <div style={{ display: 'grid', gap: 2 }}>
                              <div style={{ fontWeight: 600 }}>{tt.name || '-'}</div>
                              {tt.stageLabel ? <div style={{ color: '#6b7280' }}>{tt.stageLabel}</div> : null}
                            </div>
                            <div>
                              <span style={{ background: tt.taskType === 'WORKLOG' ? '#FEF9C3' : '#F1F5F9', color: '#334155', borderRadius: 999, padding: '0 6px' }}>{tt.taskType}</span>
                            </div>
                            <div style={{ display: 'grid', gap: 6 }}>
                              {line.length ? line.map((ins: any) => {
                                const st = ins.status;
                                const stBg = st === 'COMPLETED' ? '#DCFCE7' : st === 'IN_PROGRESS' ? '#DBEAFE' : '#F1F5F9';
                                const stFg = st === 'COMPLETED' ? '#166534' : st === 'IN_PROGRESS' ? '#1E3A8A' : '#334155';
                                return (
                                  <div key={ins.id} style={{ background: '#fafafa', borderRadius: 6, padding: 8 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                                      <span style={{ fontWeight: 600 }}>{ins.assignee?.name || '담당 미지정'}</span>
                                      <span style={{ color: '#6b7280', fontSize: 11 }}>계획: {fmtDate(ins.plannedStartAt)} ~ {fmtDate(ins.plannedEndAt)}</span>
                                      {ins.actualEndAt && <span style={{ color: '#059669', fontSize: 11 }}>완료: {fmtDate(ins.actualEndAt)}</span>}
                                      <span style={{ background: stBg, color: stFg, borderRadius: 999, padding: '0 6px', fontSize: 11 }}>{st}</span>
                                    </div>
                                    {(ins.worklogs || []).length > 0 && (
                                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #eef2f7' }}>
                                        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>업무일지 ({ins.worklogs.length}건)</div>
                                        <div style={{ display: 'grid', gap: 4 }}>
                                          {(ins.worklogs || []).map((wl: any) => (
                                            <div key={wl.id} style={{ fontSize: 12, padding: 6, background: '#fff', borderRadius: 4, border: '1px solid #e5e7eb' }}>
                                              <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                                                <span style={{ color: '#6b7280' }}>{new Date(wl.createdAt).toLocaleString()}</span>
                                                <span style={{ fontWeight: 500 }}>{wl.createdBy?.name || '-'}</span>
                                              </div>
                                              <div style={{ color: '#475569' }} dangerouslySetInnerHTML={{ __html: toSafeHtml(wl.note || '(내용 없음)') }} />
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }) : <span style={{ fontSize: 12, color: '#94a3b8' }}>담당 없음</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
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

 
