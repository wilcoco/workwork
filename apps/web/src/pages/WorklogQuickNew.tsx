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
import { DocumentTags, DocumentTagsValue } from '../components/DocumentTags';
import { WorklogDocument } from '../components/WorklogDocument';
import { UserAvatar } from '../components/UserAvatar';

export function WorklogQuickNew() {
  const nav = useNavigate();
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const processInstanceId = params?.get('processInstanceId') || '';
  const taskInstanceId = params?.get('taskInstanceId') || '';
  const helpTicketIdParam = params?.get('helpTicketId') || '';
  const [date, setDate] = useState<string>(() => todayKstYmd());
  const [teamName, setTeamName] = useState<string>('');
  const [timeSpentHours, setTimeSpentHours] = useState<number>(0);
  const [timeSpentMinutes10, setTimeSpentMinutes10] = useState<number>(0);
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | ''>('');
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
  const [photos, setPhotos] = useState<Array<{ url: string; name?: string; filename?: string; type?: string }>>([]);
  const [attachOneDriveOk, setAttachOneDriveOk] = useState<boolean>(false);
  const [attachUrl, setAttachUrl] = useState<string>('');
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
  const [tags, setTags] = useState<DocumentTagsValue>({});
  const [hashTags, setHashTags] = useState<string[]>([]);
  const [hashTagInput, setHashTagInput] = useState('');
  const [structuredMode, setStructuredMode] = useState(false);
  const [sections, setSections] = useState<{
    todayTasks: Array<{ name: string; detail: string; status: 'completed' | 'in_progress' | 'waiting' }>;
    ongoingTasks: Array<{ name: string; progressPct: number; nextAction: string }>;
    issues: Array<{ problem: string; cause: string; support: string }>;
    tomorrowPlan: Array<{ task: string; goal: string }>;
    remarks: string;
  }>({
    todayTasks: [{ name: '', detail: '', status: 'in_progress' }],
    ongoingTasks: [],
    issues: [],
    tomorrowPlan: [{ task: '', goal: '' }],
    remarks: '',
  });

  function canUpdateKrForTask(t: { isKpi?: boolean; krOwnerId?: string | null } | undefined) {
    if (!t) return false;
    if (t.isKpi) return myRole === 'MANAGER';
    return !!(t.krOwnerId && t.krOwnerId === myUserId);
  }

  async function addPhoto() {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async () => {
        try {
          const list = input.files ? Array.from(input.files) : [];
          if (!list.length) return;
          for (const file of list) {
            const up = await uploadFile(file);
            setPhotos((prev) => [...prev, { url: up.url, name: up.name, filename: up.filename, type: up.type }]);
          }
        } catch (e: any) {
          setError(e?.message || '사진 업로드 실패');
        }
      };
      input.click();
    } catch (e: any) {
      setError(e?.message || '사진 업로드 실패');
    }
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  useEffect(() => {
    const stored = localStorage.getItem('teamName') || '';
    if (stored) setTeamName(stored);
    const uid = localStorage.getItem('userId') || '';
    if (!uid) return;
    (async () => {
      try {
        const me = await apiJson<{ id: string; orgUnitId: string; role?: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' }>(`/api/users/me?userId=${encodeURIComponent(uid)}`);
        const ou = me.orgUnitId || '';
        setOrgUnitId(ou);
        setMyRole((me as any)?.role || '');
        const myId = me.id || uid;
        // Always load my own initiatives (personal OKR/KPI tasks) and enrich with my OKR metadata (O/KR)
        try {
          const mine = await apiJson<{ items: any[] }>(`/api/initiatives/my?userId=${encodeURIComponent(uid)}`);
          const mokrs = await apiJson<{ items: any[] }>(`/api/okrs/my?userId=${encodeURIComponent(uid)}`);
          const meta: Record<string, { objTitle: string; krTitle: string; isKpi: boolean; krTarget: number | null; krUnit?: string; krBaseline?: number | null; krDirection?: 'AT_LEAST' | 'AT_MOST'; krOwnerId?: string | null }> = {};
          for (const o of (mokrs.items || [])) {
            for (const kr of (o.keyResults || [])) {
              meta[kr.id] = { objTitle: o.title, krTitle: kr.title, isKpi: !!o.pillar, krTarget: typeof kr.target === 'number' ? kr.target : null, krUnit: kr.unit, krBaseline: (typeof kr.baseline === 'number' ? kr.baseline : null), krDirection: (kr as any)?.direction, krOwnerId: (kr as any)?.ownerId ?? null };
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
            return { id: ii.id, title, initTitle, objTitle: mm?.objTitle, krTitle: mm?.krTitle, isKpi: mm?.isKpi, period: pc, startAt: s, krId: ii.keyResultId, krTarget: mm?.krTarget ?? null, krUnit: mm?.krUnit, krBaseline: mm?.krBaseline ?? null, krDirection: mm?.krDirection, krOwnerId: mm?.krOwnerId ?? null };
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

        // Load 업무 요청(HelpTicket) assigned to me and 이미 수락/진행 중인 것들만 노출
        try {
          const acc = await apiJson<{ items: any[] }>(`/api/help-tickets?assigneeId=${encodeURIComponent(myId)}&status=ACCEPTED`);
          const prog = await apiJson<{ items: any[] }>(`/api/help-tickets?assigneeId=${encodeURIComponent(myId)}&status=IN_PROGRESS`);
          const all = [...(acc.items || []), ...(prog.items || [])];
          const dedup: Record<string, any> = {};
          for (const t of all) dedup[t.id] = t;
          const tickets = Object.values(dedup).map((t: any) => {
            const who = t.requester?.name || '요청자 미상';
            const cat = t.category || '일반 업무 요청';
            const helpTitle = t.helpTitle || '';
            const titlePart = helpTitle ? ` · ${helpTitle}` : '';
            // 업무 요청 제목 중심으로 표시: 업무 요청: [카테고리] · [제목] · [요청자]
            return { id: String(t.id), label: `업무 요청: ${cat}${titlePart} · ${who}` };
          });
          if (helpTicketIdParam) {
            const exists = tickets.some((t: any) => String(t.id) === String(helpTicketIdParam));
            if (!exists) {
              try {
                const t = await apiJson<any>(`/api/help-tickets/${encodeURIComponent(helpTicketIdParam)}`);
                const who = t.requester?.name || '요청자 미상';
                const cat = t.category || '일반 업무 요청';
                const helpTitle = t.helpTitle || '';
                const titlePart = helpTitle ? ` · ${helpTitle}` : '';
                tickets.unshift({ id: String(t.id), label: `업무 요청: ${cat}${titlePart} · ${who}` });
              } catch {}
            }
            setSelection((prev) => (prev ? prev : `help:${helpTicketIdParam}`));
          }
          setHelpTickets(tickets);
        } catch {}
      } catch {}
    })();
  }, [helpTicketIdParam]);

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
      if (!selection || !(selection.startsWith('init:') || selection.startsWith('kr:') || selection.startsWith('help:') || selection.startsWith('proc:') || selection.startsWith('new:'))) throw new Error('대상을 선택하세요');
      if (Number(timeSpentHours) < 0) throw new Error('업무 소요 시간(시간)은 0 이상이어야 합니다');
      if (![0, 10, 20, 30, 40, 50].includes(Number(timeSpentMinutes10))) throw new Error('업무 소요 시간(분)은 10분 단위로 선택해 주세요');
      const computedMinutes = (Number(timeSpentHours) || 0) * 60 + (Number(timeSpentMinutes10) || 0);
      const wl = await apiJson<{ id: string; initiativeId?: string }>(
        '/api/worklogs/simple',
        {
          method: 'POST',
          body: JSON.stringify({
            userId,
            teamName,
            timeSpentMinutes: computedMinutes,
            initiativeId: selection.startsWith('init:') ? selection.substring(5) : undefined,
            keyResultId: selection.startsWith('kr:') ? selection.substring(3) : undefined,
            // help: 선택 시에는 별도 링크 없이 일반 업무일지로만 기록
            // proc: 선택 시에는 내부적으로 OKR 스캐폴딩 하여 initiative 자동 생성 필요 → taskName을 제공
            taskName: selection.startsWith('kr:')
              ? (title || 'KPI 보고')
              : (selection.startsWith('proc:')
                ? (title || '프로세스 업무')
                : (selection.startsWith('new:')
                  ? (title || '신규 과제')
                  : undefined)),
            title,
            content: structuredMode
              ? (() => {
                  const lines: string[] = [];
                  lines.push('【금일 수행 업무】');
                  sections.todayTasks.filter(t => t.name.trim()).forEach(t => {
                    const st = t.status === 'completed' ? '완료' : t.status === 'in_progress' ? '진행' : '대기';
                    lines.push(`- ${t.name} [${st}]${t.detail ? ': ' + t.detail : ''}`);
                  });
                  if (sections.ongoingTasks.some(t => t.name.trim())) {
                    lines.push('', '【진행 중 업무】');
                    sections.ongoingTasks.filter(t => t.name.trim()).forEach(t => {
                      lines.push(`- ${t.name} (${t.progressPct}%)${t.nextAction ? ' → ' + t.nextAction : ''}`);
                    });
                  }
                  if (sections.issues.some(t => t.problem.trim())) {
                    lines.push('', '【이슈 / 문제】');
                    sections.issues.filter(t => t.problem.trim()).forEach(t => {
                      lines.push(`- 문제: ${t.problem}${t.cause ? ' / 원인: ' + t.cause : ''}${t.support ? ' / 지원: ' + t.support : ''}`);
                    });
                  }
                  if (sections.tomorrowPlan.some(t => t.task.trim())) {
                    lines.push('', '【익일 계획】');
                    sections.tomorrowPlan.filter(t => t.task.trim()).forEach(t => {
                      lines.push(`- ${t.task}${t.goal ? ' (목표: ' + t.goal + ')' : ''}`);
                    });
                  }
                  if (sections.remarks.trim()) {
                    lines.push('', '【특이사항 / 건의】', sections.remarks.trim());
                  }
                  return lines.join('\n');
                })()
              : (plainMode ? contentPlain : stripHtml(contentHtml)),
            contentHtml: structuredMode ? undefined : (plainMode ? undefined : (contentHtml || undefined)),
            attachments: { files: attachments, photos },
            date,
            urgent,
            visibility,
            tags: (tags.itemCode || tags.moldCode || tags.carModelCode || tags.supplierCode || tags.equipmentCode || hashTags.length) ? { ...tags, hashTags: hashTags.length ? hashTags : undefined } : undefined,
            structuredData: structuredMode ? sections : undefined,
          }),
        }
      );
      const isKR = selection.startsWith('kr:');
      const isInit = selection.startsWith('init:');
      const isHelp = selection.startsWith('help:');
      const isProc = selection.startsWith('proc:');
      const isNew = selection.startsWith('new:');
      const createdInitId = String((wl as any)?.initiativeId || '');
      const selectedId = isKR
        ? selection.substring(3)
        : (isInit
          ? selection.substring(5)
          : (isHelp
            ? selection.substring(5)
            : (isProc
              ? selection.substring(5)
              : '')));
      const selected = isInit ? [...teamTasks, ...myTasks].find((x) => x.id === selectedId) : undefined;
      // Progress: initiative done (help 선택 시에는 제외)
      if ((isInit || isNew) && initiativeDone) {
        const initIdForProgress = isNew ? createdInitId : selectedId;
        if (initIdForProgress) {
          const mine = myTasks.some((x) => x.id === selectedId);
          const team = teamTasks.some((x) => x.id === selectedId);
          const canUpdateInit = isNew ? true : (mine ? true : (team ? myRole === 'MANAGER' : false));
          if (canUpdateInit) {
            try {
              await apiJson('/api/progress', {
                method: 'POST',
                body: JSON.stringify({ subjectType: 'INITIATIVE', subjectId: initIdForProgress, actorId: userId, worklogId: wl.id, initiativeDone: true, note: title || undefined, at: date }),
              });
            } catch {}
          }
        }
      }
      // Progress: KR value (explicit or achieved) — help 선택 시에는 KR가 없으므로 그대로 조건 유지
      if ((isKR || selected?.krId) && (krValue !== '' || krAchieved)) {
        const canUpdateKr = isKR ? (myRole === 'MANAGER') : canUpdateKrForTask(selected as any);
        if (canUpdateKr) {
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
            try {
              await apiJson('/api/progress', {
                method: 'POST',
                body: JSON.stringify({ subjectType: 'KR', subjectId: isKR ? selectedId : (selected as any).krId, actorId: userId, worklogId: wl.id, krValue: valueToSend, note: title || undefined, at: date }),
              });
            } catch {}
          }
        }
      }
      // Help: 업무 요청 선택으로 생성된 업무일지인 경우, 해당 HelpTicket을 업무 요청 완료로 표시하고 대응 업무일지 링크를 저장한다.
      if (isHelp) {
        const ticketId = selectedId;
        if (initiativeDone) {
          await apiJson(`/api/help-tickets/${encodeURIComponent(ticketId)}/resolve`, {
            method: 'POST',
            body: JSON.stringify({ actorId: userId, worklogId: wl.id }),
          });
        } else {
          await apiJson(`/api/help-tickets/${encodeURIComponent(ticketId)}/start`, {
            method: 'POST',
            body: JSON.stringify({ actorId: userId, worklogId: wl.id }),
          });
        }
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

  function addAttachmentLink() {
    const raw = String(attachUrl || '').trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) {
      setError('첨부 링크는 http(s) 주소여야 합니다.');
      return;
    }

    try {
      const u = new URL(raw);
      const h = String(u.hostname || '').toLowerCase();
      const allowed = h === 'cams2002-my.sharepoint.com' || h.endsWith('.cams2002-my.sharepoint.com');
      if (!allowed) {
        window.alert('회사 원드라이브(SharePoint) 링크만 첨부할 수 있습니다.\n허용 도메인: cams2002-my.sharepoint.com');
        setError('회사 원드라이브(SharePoint) 링크만 첨부할 수 있습니다.');
        return;
      }
    } catch {
      setError('첨부 링크 형식이 올바르지 않습니다.');
      return;
    }

    if (!attachOneDriveOk) {
      const ok = window.confirm('Teams/OneDrive(회사) 공유 링크만 첨부하세요. 계속할까요?');
      if (!ok) return;
      setAttachOneDriveOk(true);
    }
    setAttachments((prev) => [...prev, { url: raw, name: raw }]);
    setAttachUrl('');
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 760, margin: '24px auto' }}>
      <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 12, padding: '10px 12px' }}>
        <div style={{ fontSize: 13, color: '#92400e', fontWeight: 700, lineHeight: 1.45 }}>
          이 업무일지는 테스트 중인 상태이며 주된 업무일지는 기존 업무일지 앱에 작성해주세요.
        </div>
      </div>
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
          <div className="resp-2">
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 13, color: '#6b7280' }}>업무시간 (10분 단위)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min={0}
                  value={timeSpentHours}
                  onChange={(e) => setTimeSpentHours(Math.max(0, Number(e.target.value) || 0))}
                  style={{ ...input, width: 120 }}
                  placeholder="시간"
                />
                <div style={{ color: '#64748b', fontSize: 13 }}>시간</div>
                <select
                  value={timeSpentMinutes10}
                  onChange={(e) => setTimeSpentMinutes10(Number(e.target.value))}
                  style={{ ...input, width: 120, appearance: 'auto' as any }}
                >
                  {[0, 10, 20, 30, 40, 50].map((m) => (
                    <option key={m} value={m}>{m}분</option>
                  ))}
                </select>
              </div>
            </label>
            <div />
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, color: '#6b7280' }}>OKR 과제 / KPI 과제 / 업무 요청 / 신규 과제</label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              과제 선택은 목표관리(OKR/KPI)와 연동됩니다. 여기서 선택한 OKR/KPI 과제는 목표관리에서 등록된 과제/지표(KR) 목록입니다.
            </div>
            <select value={selection} onChange={(e) => {
              const v = e.target.value;
              setSelection(v);
              setError(null);
              setKrValue('');
              setKrAchieved(false);
              // Keep current date as-is (default is today in KST)
            }} style={{ ...input, appearance: 'auto' as any }} required>
              <option value="" disabled>대상을 선택하세요</option>
              <optgroup label="신규 과제">
                <option value="new:1">신규 과제</option>
              </optgroup>
              {myProcTasks.length > 0 && (
                <optgroup label="프로세스 과제">
                  {myProcTasks.map((t) => (
                    <option key={`proc-${t.id}`} value={`proc:${t.id}`}>프로세스: {t.instance?.title || ''} / {t.name}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="OKR 과제">
                {(() => {
                  // OKR 과제에는 순수 OKR만 노출하고, KPI에 속한 과제와 결재/업무 요청(Auto Objective) 과제는 모두 제외한다.
                  const list = myTasks.filter((t) => {
                    if (t.isKpi) return false;
                    const obj = String(t.objTitle || '');
                    if (obj.toLowerCase().includes('auto objective')) return false;
                    return true;
                  });
                  return list.map((t) => {
                    const initLabel = String(t.initTitle || (() => { const parts = String(t.title||'').split('/'); return parts.length>1? parts[parts.length-1].trim() : (t.title||''); })());
                    const parts: string[] = [];
                    if (t.objTitle) parts.push(String(t.objTitle));
                    if (t.krTitle) parts.push(`${t.isKpi ? 'KPI' : 'KR'}: ${t.krTitle}`);
                    const prefix = parts.join(' / ');
                    const label = prefix ? `${prefix} / ${initLabel}` : initLabel;
                    return (
                      <option key={`init-${t.id}`} value={`init:${t.id}`}>{label}</option>
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
                <optgroup label="업무 요청 추가">
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
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 1.45 }}>
            긴급 보고: 품질/설비/납기 등 즉시 공유가 필요한 이슈일 때 체크합니다.
            <br />
            과제 완료: 이번 업무일지로 해당 과제가 완료되었을 때 체크합니다. (과제 완료로 기록됩니다)
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
              if (mine) {
                const t = myTasks.find((x) => x.id === sId) as any;
                return !canUpdateKrForTask(t);
              }
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
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
                  목표 달성(달성값) 입력: 선택한 OKR/KPI 지표(KR)의 실적을 기록할 때 사용합니다. 숫자를 입력하거나, “목표 달성”을 체크하면 목표값이 자동으로 기록됩니다.
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
              본문 작성 {structuredMode ? '(구조화 모드)' : plainMode ? '(텍스트 모드)' : '(리치 모드)'}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" className="btn btn-sm" style={structuredMode ? { background: '#0F3D73', color: '#fff' } : {}} onClick={() => { setStructuredMode(true); setPlainMode(false); }}>구조화</button>
              <button type="button" className="btn btn-sm" style={!structuredMode && !plainMode ? { background: '#0F3D73', color: '#fff' } : {}} onClick={() => { setStructuredMode(false); setPlainMode(false); }}>리치</button>
              <button type="button" className="btn btn-sm" style={!structuredMode && plainMode ? { background: '#0F3D73', color: '#fff' } : {}} onClick={() => { setStructuredMode(false); setPlainMode(true); }}>텍스트</button>
            </div>
          </div>
          {structuredMode ? (
            <div style={{ display: 'grid', gap: 14, border: '1px solid #E5E7EB', borderRadius: 10, padding: 14, background: '#FAFBFC' }}>
              {/* 1. 금일 수행 업무 */}
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>1. 금일 수행 업무</div>
                  <button type="button" className="btn btn-sm btn-outline" style={{ fontSize: 11 }}
                    onClick={() => setSections(p => ({ ...p, todayTasks: [...p.todayTasks, { name: '', detail: '', status: 'in_progress' }] }))}>+ 추가</button>
                </div>
                {sections.todayTasks.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto auto', gap: 6, alignItems: 'start' }}>
                    <input value={t.name} onChange={e => setSections(p => ({ ...p, todayTasks: p.todayTasks.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                      placeholder="업무명" style={input} />
                    <input value={t.detail} onChange={e => setSections(p => ({ ...p, todayTasks: p.todayTasks.map((x, j) => j === i ? { ...x, detail: e.target.value } : x) }))}
                      placeholder="세부내용" style={input} />
                    <select value={t.status} onChange={e => setSections(p => ({ ...p, todayTasks: p.todayTasks.map((x, j) => j === i ? { ...x, status: e.target.value as any } : x) }))}
                      style={{ ...input, width: 80, appearance: 'auto' as any, fontSize: 12 }}>
                      <option value="completed">완료</option>
                      <option value="in_progress">진행</option>
                      <option value="waiting">대기</option>
                    </select>
                    {sections.todayTasks.length > 1 && (
                      <button type="button" onClick={() => setSections(p => ({ ...p, todayTasks: p.todayTasks.filter((_, j) => j !== i) }))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 14, padding: '8px 4px' }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              {/* 2. 진행 중 업무 */}
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>2. 진행 중 업무</div>
                  <button type="button" className="btn btn-sm btn-outline" style={{ fontSize: 11 }}
                    onClick={() => setSections(p => ({ ...p, ongoingTasks: [...p.ongoingTasks, { name: '', progressPct: 0, nextAction: '' }] }))}>+ 추가</button>
                </div>
                {sections.ongoingTasks.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>항목 없음 ("추가" 버튼으로 추가)</div>}
                {sections.ongoingTasks.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr auto', gap: 6, alignItems: 'start' }}>
                    <input value={t.name} onChange={e => setSections(p => ({ ...p, ongoingTasks: p.ongoingTasks.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))}
                      placeholder="업무명" style={input} />
                    <input type="number" min={0} max={100} value={t.progressPct} onChange={e => setSections(p => ({ ...p, ongoingTasks: p.ongoingTasks.map((x, j) => j === i ? { ...x, progressPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } : x) }))}
                      placeholder="%" style={{ ...input, textAlign: 'center' as any }} />
                    <input value={t.nextAction} onChange={e => setSections(p => ({ ...p, ongoingTasks: p.ongoingTasks.map((x, j) => j === i ? { ...x, nextAction: e.target.value } : x) }))}
                      placeholder="다음 액션" style={input} />
                    <button type="button" onClick={() => setSections(p => ({ ...p, ongoingTasks: p.ongoingTasks.filter((_, j) => j !== i) }))}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 14, padding: '8px 4px' }}>✕</button>
                  </div>
                ))}
              </div>
              {/* 3. 이슈 / 문제 */}
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>3. 이슈 / 문제</div>
                  <button type="button" className="btn btn-sm btn-outline" style={{ fontSize: 11 }}
                    onClick={() => setSections(p => ({ ...p, issues: [...p.issues, { problem: '', cause: '', support: '' }] }))}>+ 추가</button>
                </div>
                {sections.issues.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>이슈 없음 ("추가" 버튼으로 등록)</div>}
                {sections.issues.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, alignItems: 'start' }}>
                    <input value={t.problem} onChange={e => setSections(p => ({ ...p, issues: p.issues.map((x, j) => j === i ? { ...x, problem: e.target.value } : x) }))}
                      placeholder="발생 문제" style={input} />
                    <input value={t.cause} onChange={e => setSections(p => ({ ...p, issues: p.issues.map((x, j) => j === i ? { ...x, cause: e.target.value } : x) }))}
                      placeholder="원인" style={input} />
                    <input value={t.support} onChange={e => setSections(p => ({ ...p, issues: p.issues.map((x, j) => j === i ? { ...x, support: e.target.value } : x) }))}
                      placeholder="필요 지원" style={input} />
                    <button type="button" onClick={() => setSections(p => ({ ...p, issues: p.issues.filter((_, j) => j !== i) }))}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 14, padding: '8px 4px' }}>✕</button>
                  </div>
                ))}
              </div>
              {/* 4. 익일 계획 */}
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>4. 익일 계획</div>
                  <button type="button" className="btn btn-sm btn-outline" style={{ fontSize: 11 }}
                    onClick={() => setSections(p => ({ ...p, tomorrowPlan: [...p.tomorrowPlan, { task: '', goal: '' }] }))}>+ 추가</button>
                </div>
                {sections.tomorrowPlan.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'start' }}>
                    <input value={t.task} onChange={e => setSections(p => ({ ...p, tomorrowPlan: p.tomorrowPlan.map((x, j) => j === i ? { ...x, task: e.target.value } : x) }))}
                      placeholder="예정 작업" style={input} />
                    <input value={t.goal} onChange={e => setSections(p => ({ ...p, tomorrowPlan: p.tomorrowPlan.map((x, j) => j === i ? { ...x, goal: e.target.value } : x) }))}
                      placeholder="목표" style={input} />
                    {sections.tomorrowPlan.length > 1 && (
                      <button type="button" onClick={() => setSections(p => ({ ...p, tomorrowPlan: p.tomorrowPlan.filter((_, j) => j !== i) }))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 14, padding: '8px 4px' }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              {/* 5. 특이사항 / 건의 */}
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>5. 특이사항 / 건의</div>
                <textarea value={sections.remarks} onChange={e => setSections(p => ({ ...p, remarks: e.target.value }))}
                  placeholder="개선사항, 건의사항 등을 자유롭게 입력하세요." rows={3}
                  style={{ ...input, resize: 'vertical' as any, fontSize: 13, lineHeight: 1.6 }} />
              </div>
            </div>
          ) : (
            <>
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
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 1.45 }}>
                사진 입력: 상단 편집기 툴바의 이미지 버튼을 사용해 본문에 삽입해 주세요.
              </div>
            </>
          )}
          
          <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
            <label style={{ fontSize: 13, color: '#6b7280' }}>사진 추가</label>
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45 }}>
              사진은 본문 아래에 별도로 표시됩니다. (업로드 후 저장하면 모든 사용자가 볼 수 있습니다)
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-sm" onClick={addPhoto}>
                사진 추가
              </button>
            </div>
            {photos.length > 0 && (
              <div className="attachments">
                {photos.map((p, i) => (
                  <div key={`${p.url}-${i}`} className="attachment-item" style={{ display: 'grid', gap: 8 }}>
                    <img src={p.url} alt={p.name || p.filename || 'photo'} style={{ maxWidth: '100%', height: 'auto', borderRadius: 12 }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 12, color: '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.name || p.filename || p.url}
                      </div>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => removePhoto(i)}>삭제</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
            <label style={{ fontSize: 13, color: '#6b7280' }}>첨부 파일</label>
            <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45 }}>
              파일 첨부: Teams/OneDrive에 있는 파일은 업로드하지 않고, 공유 링크를 붙여넣어 첨부합니다.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={attachUrl}
                onChange={(e) => setAttachUrl(e.target.value)}
                placeholder="Teams/OneDrive 공유 링크를 붙여넣으세요"
                style={{ ...input, flex: 1, minWidth: 240 }}
              />
              <button type="button" className="btn btn-sm" onClick={addAttachmentLink} disabled={!String(attachUrl || '').trim()}>
                링크 추가
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => window.open('https://office.com/launch/onedrive', '_blank', 'noopener,noreferrer')}
              >OneDrive 열기</button>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
              <input type="checkbox" checked={attachOneDriveOk} onChange={(e) => setAttachOneDriveOk(e.target.checked)} />
              원드라이브/Teams 링크만 첨부합니다
            </label>
            <div style={{ fontSize: 12, color: '#6b7280' }}>원드라이브/Teams 공유 링크만 첨부해 주세요.</div>
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
          <DocumentTags value={tags} onChange={setTags} />
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>#️⃣ 자유 태그</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {hashTags.map((ht, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#EFF6FF', color: '#1e40af', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>
                  #{ht}
                  <button type="button" onClick={() => setHashTags(p => p.filter((_, j) => j !== i))}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#1e40af', fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                </span>
              ))}
              <input value={hashTagInput}
                onChange={e => setHashTagInput(e.target.value.replace(/\s+/g, ''))}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ' ' || e.key === ',') && hashTagInput.trim()) {
                    e.preventDefault();
                    const tag = hashTagInput.replace(/^#/, '').trim();
                    if (tag && !hashTags.includes(tag)) setHashTags(p => [...p, tag]);
                    setHashTagInput('');
                  }
                }}
                placeholder="#사출 #ERP #설비점검 (Enter로 추가)"
                style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '4px 8px', fontSize: 12, outline: 'none', minWidth: 180 }} />
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>태그를 입력하고 Enter를 누르세요. 예: 사출프로세스, ERP, 품질이슈</div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => { setTitle(''); setContentHtml(''); setContentPlain(''); setPlainMode(false); setStructuredMode(false); setSections({ todayTasks: [{ name: '', detail: '', status: 'in_progress' }], ongoingTasks: [], issues: [], tomorrowPlan: [{ task: '', goal: '' }], remarks: '' }); setAttachments([]); setPhotos([]); setTags({}); setHashTags([]); setHashTagInput(''); setTimeSpentHours(0); setTimeSpentMinutes10(0); }}>
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
                                                <span style={{ fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                  {wl.createdBy?.name || '-'}
                                                  {wl.createdBy?.id && wl.createdBy?.name ? <UserAvatar userId={String(wl.createdBy.id)} name={String(wl.createdBy.name)} size={14} /> : null}
                                                </span>
                                              </div>
                                              <div style={{ marginTop: 4 }}>
                                                <WorklogDocument
                                                  worklog={wl}
                                                  variant="content"
                                                />
                                              </div>
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

 
