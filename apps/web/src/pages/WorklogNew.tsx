import { useEffect, useState } from 'react';
import { LoadingButton } from '../components/LoadingButton';
import { useNavigate } from 'react-router-dom';
import { WorklogAiFollowup } from '../components/WorklogAiFollowup';
import { apiFetch } from '../lib/api';

interface ProcTask {
  id: string;
  name: string;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  status: string;
  assigneeId?: string | null;
  emailTo?: string | null;
  emailCc?: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  assignee?: { id: string; name: string; email?: string } | null;
  taskTemplate?: {
    id: string;
    emailToTemplate?: string | null;
    emailCcTemplate?: string | null;
    emailSubjectTemplate?: string | null;
    emailBodyTemplate?: string | null;
  } | null;
}
interface ProcInst {
  id: string;
  title: string;
  startedBy?: { id: string; name: string; email?: string } | null;
  template?: { id: string; title: string } | null;
  initiative?: { id: string; title?: string | null } | null;
  tasks?: ProcTask[];
}
interface UserMe { id: string; name: string; email?: string };

export function WorklogNew() {
  const nav = useNavigate();
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const processInstanceId = params?.get('processInstanceId') || '';
  const taskInstanceId = params?.get('taskInstanceId') || '';
  const paramInitiativeId = params?.get('initiativeId') || '';
  const paramInstructionId = params?.get('instructionId') || '';
  const [initiativeId, setInitiativeId] = useState(paramInitiativeId);
  const [taskName, setTaskName] = useState('');
  const [instruction, setInstruction] = useState<{
    id: string;
    title: string;
    assignerName: string;
    dueDate?: string;
    sourceWorklogId?: string;
    sourceWorklogTitle?: string;
    description?: string;
  } | null>(null);
  const myUserId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [createdById, setCreatedById] = useState('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [timeSpentHours, setTimeSpentHours] = useState<number>(0);
  const [timeSpentMinutes10, setTimeSpentMinutes10] = useState<number>(0);
  const [blockerCode, setBlockerCode] = useState('');
  const [note, setNote] = useState('');
  const [krId, setKrId] = useState('');
  const [krValue, setKrValue] = useState<string>('');
  const [initiativeDone, setInitiativeDone] = useState<boolean>(false);
  const [krAchieved, setKrAchieved] = useState<boolean>(false);
  const [urgent, setUrgent] = useState<boolean>(false);
  const [attachments, setAttachments] = useState<Array<{ url: string; name?: string }>>([]);
  const [attachUrl, setAttachUrl] = useState<string>('');
  const [attachOneDriveOk, setAttachOneDriveOk] = useState<boolean>(false);
  // 공유 범위 선택: anonymous(링크 공개) / organization(회사 내부) / skip(변경 없음)
  const [shareScope, setShareScope] = useState<'anonymous' | 'organization' | 'skip'>('organization');

  // follow-up actions
  const [approverId, setApproverId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [watchers, setWatchers] = useState(''); // comma-separated userIds
  const [externalRecipientEmails, setExternalRecipientEmails] = useState('');

  // help (single item for MVP)
  const [helpCategory, setHelpCategory] = useState('');
  const [helpQueue, setHelpQueue] = useState('');
  const [helpAssigneeId, setHelpAssigneeId] = useState('');
  const [helpSla, setHelpSla] = useState<number | ''>('');
  const [helpDueAt, setHelpDueAt] = useState('');

  // delegation (single item for MVP)
  const [parentType, setParentType] = useState('Initiative');
  const [parentId, setParentId] = useState('');
  const [childInitiativeId, setChildInitiativeId] = useState('');
  const [delegateeId, setDelegateeId] = useState('');
  const [delegateDueAt, setDelegateDueAt] = useState('');

  const [submitting, setSubmitting] = useState(false);
  // 저장 직후 AI 보완 질문/지식배지 심사 (공용 컴포넌트)
  const [aiFollowupId, setAiFollowupId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName: string }>>([]);
  const [myProcTasks, setMyProcTasks] = useState<Array<{ id: string; name: string; instance: { id: string; title: string } }>>([]);
  const [selectedProcTaskId, setSelectedProcTaskId] = useState<string>(taskInstanceId || '');
  const [selectedProcInstId, setSelectedProcInstId] = useState<string>(processInstanceId || '');
  const [showProcPopup, setShowProcPopup] = useState(false);
  const [me, setMe] = useState<UserMe | null>(null);
  const [procInst, setProcInst] = useState<ProcInst | null>(null);
  const [procTask, setProcTask] = useState<ProcTask | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailInitKey, setEmailInitKey] = useState('');

  useEffect(() => {
    if (myUserId && !createdById) setCreatedById(myUserId);
    (async () => {
      try {
        const r = await apiFetch('/api/users');
        if (r.ok) {
          const d = await r.json();
          setUsers((d?.items || []).map((u: any) => ({ id: u.id, name: u.name, orgName: u.orgName || '' })));
        }
      } catch {}
    })();
  }, [myUserId]);

  useEffect(() => {
    if (!myUserId) return;
    (async () => {
      try {
        const r = await apiFetch(`/api/users/me?userId=${encodeURIComponent(myUserId)}`);
        if (!r.ok) return;
        const d = await r.json();
        setMe(d || null);
      } catch {}
    })();
  }, [myUserId]);

  // 업무 지시에서 온 경우 지시 정보 로드 및 본문 프리필
  useEffect(() => {
    if (!paramInstructionId) return;
    (async () => {
      try {
        const r = await apiFetch(`/api/instructions?limit=100`);
        if (!r.ok) return;
        const data = await r.json();
        const found = (data.items || []).find((i: any) => i.id === paramInstructionId);
        if (found) {
          // 원본 업무일지 정보 조회
          let sourceWorklogTitle = '';
          if (found.sourceWorklogId) {
            try {
              const wlRes = await apiFetch(`/api/worklogs/${encodeURIComponent(found.sourceWorklogId)}`);
              if (wlRes.ok) {
                const wl = await wlRes.json();
                sourceWorklogTitle = (wl.note || '').split('\n')[0] || '(제목 없음)';
              }
            } catch {}
          }

          setInstruction({
            id: found.id,
            title: found.title || '',
            assignerName: found.assignerName || '',
            dueDate: found.dueDate,
            sourceWorklogId: found.sourceWorklogId,
            sourceWorklogTitle,
            description: found.description,
          });

          // 과제명 설정
          if (found.title && !taskName) setTaskName(found.title);

          // 본문 프리필: 원본 업무일지 링크 + 업무지시 내용
          if (!note) {
            const lines: string[] = [];
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push(`📌 업무 지시 보고`);
            lines.push(`지시자: ${found.assignerName || '(미상)'}`);
            lines.push(`지시 내용: ${found.title || ''}`);
            if (found.description) lines.push(`상세: ${found.description}`);
            if (found.dueDate) lines.push(`마감일: ${new Date(found.dueDate).toLocaleDateString()}`);
            if (found.sourceWorklogId) {
              const baseUrl = window.location.origin;
              lines.push(`원본 업무일지: ${baseUrl}/worklogs/${found.sourceWorklogId}`);
              if (sourceWorklogTitle) lines.push(`원본 제목: ${sourceWorklogTitle}`);
            }
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push('');
            lines.push('');
            setNote(lines.join('\n'));
          }
        }
      } catch {}
    })();
  }, [paramInstructionId]);

  useEffect(() => {
    (async () => {
      if (!myUserId) return;
      try {
        const r = await apiFetch(`/api/processes/inbox?assigneeId=${encodeURIComponent(myUserId)}`);
        if (r.ok) {
          const items = await r.json();
          const onlyWorklog = (items || []).filter((t: any) => String(t.taskType).toUpperCase() === 'WORKLOG');
          const filtered = processInstanceId ? onlyWorklog.filter((t: any) => t.instance?.id === processInstanceId) : onlyWorklog;
          setMyProcTasks(filtered);
        }
      } catch {}
    })();
  }, [myUserId, processInstanceId]);

  useEffect(() => {
    const pid = selectedProcInstId || processInstanceId;
    if (!pid) {
      setProcInst(null);
      setProcTask(null);
      return;
    }
    let ignore = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/processes/${encodeURIComponent(pid)}`);
        if (!r.ok) return;
        const d = await r.json();
        if (!ignore) setProcInst(d || null);
      } catch {}
    })();
    return () => {
      ignore = true;
    };
  }, [selectedProcInstId, processInstanceId]);

  useEffect(() => {
    const tid = selectedProcTaskId || taskInstanceId;
    if (!procInst || !tid) {
      setProcTask(null);
      return;
    }
    const found = (procInst?.tasks || []).find((t) => String(t.id) === String(tid));
    setProcTask(found || null);
  }, [procInst, selectedProcTaskId, taskInstanceId]);

  const hasVal = (v: any): boolean => String(v || '').trim().length > 0;
  const ctxGet = (obj: any, path: string): any => {
    const parts = String(path || '')
      .split('.')
      .map((s) => s.trim())
      .filter(Boolean);
    let cur: any = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  };
  const interpolate = (tmpl: string, ctx: any): string => {
    const raw = String(tmpl || '');
    if (!raw.includes('{{')) return raw;
    return raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr) => {
      const key = String(expr || '').trim();
      if (!key) return '';
      const val = ctxGet(ctx, key);
      if (val == null) return '';
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
      try { return JSON.stringify(val); } catch { return String(val); }
    });
  };
  const normalizeRecipients = (s: string): string => {
    const parts = String(s || '')
      .split(/[;\n,]+/g)
      .map((x) => x.trim())
      .filter(Boolean);
    return parts.join(';');
  };
  const htmlToText = (s: string): string => {
    const raw = String(s || '');
    if (!raw) return '';
    if (typeof document === 'undefined') return raw;
    try {
      const el = document.createElement('div');
      el.innerHTML = raw;
      const text = (el as any).innerText || el.textContent || '';
      return String(text || '').trim();
    } catch {
      return raw;
    }
  };

  useEffect(() => {
    if (!procInst || !procTask) {
      setEmailInitKey('');
      return;
    }
    const key = `${procInst.id}:${procTask.id}`;
    if (emailInitKey === key) return;
    setEmailInitKey(key);

    const tt = procTask?.taskTemplate || null;
    const ctx = {
      process: procInst,
      task: procTask,
      assignee: procTask?.assignee || null,
      starter: procInst?.startedBy || null,
      me: me || null,
      template: procInst?.template || null,
      initiative: procInst?.initiative || null,
    };

    const toSrc = hasVal(procTask?.emailTo) ? String(procTask?.emailTo) : String(tt?.emailToTemplate || '');
    const ccSrc = hasVal(procTask?.emailCc) ? String(procTask?.emailCc) : String(tt?.emailCcTemplate || '');
    const subjectSrc = hasVal(procTask?.emailSubject) ? String(procTask?.emailSubject) : String(tt?.emailSubjectTemplate || '');
    const bodySrc = hasVal(procTask?.emailBody) ? String(procTask?.emailBody) : String(tt?.emailBodyTemplate || '');

    const to = normalizeRecipients(interpolate(toSrc, ctx));
    const cc = normalizeRecipients(interpolate(ccSrc, ctx));
    const subject = interpolate(subjectSrc, ctx);
    const bodyInterpolated = interpolate(bodySrc, ctx);
    const bodyText = hasVal(procTask?.emailBody) ? bodyInterpolated : htmlToText(bodyInterpolated);

    setEmailTo(to);
    setEmailCc(cc);
    setEmailSubject(subject);
    setEmailBody(bodyText);
  }, [procInst, procTask, me, emailInitKey]);

  const buildEmailNoteBlock = () => {
    if (!hasVal(emailBody)) return '';
    return String(emailBody || '');
  };
  const hasEmailValues = (t: ProcTask | null): boolean => {
    if (!t) return false;
    const tt = t?.taskTemplate || null;
    const parts = [
      t?.emailTo,
      t?.emailCc,
      t?.emailSubject,
      t?.emailBody,
      tt?.emailToTemplate,
      tt?.emailCcTemplate,
      tt?.emailSubjectTemplate,
      tt?.emailBodyTemplate,
    ];
    return parts.some((x) => hasVal(x));
  };
  const showEmailSection = !!procTask && String(procTask?.taskType || '').toUpperCase() === 'WORKLOG' && hasEmailValues(procTask);
  const emailNoteBlock = showEmailSection ? buildEmailNoteBlock() : '';

  const openOutlookWebCompose = () => {
    const ctx = {
      process: procInst,
      task: procTask,
      assignee: procTask?.assignee || null,
      starter: procInst?.startedBy || null,
      me: me || null,
      template: procInst?.template || null,
      initiative: procInst?.initiative || null,
    };
    const to = normalizeRecipients(interpolate(emailTo, ctx));
    const cc = normalizeRecipients(interpolate(emailCc, ctx));
    const subject = interpolate(emailSubject, ctx);
    const bodyText = interpolate(emailBody, ctx);
    const base = String((import.meta as any)?.env?.VITE_OUTLOOK_WEB_COMPOSE_BASE || 'https://outlook.office.com/mail/deeplink/compose').trim();
    try {
      const u = new URL(base);
      if (to) u.searchParams.set('to', to);
      if (cc) u.searchParams.set('cc', cc);
      if (subject) u.searchParams.set('subject', subject);
      if (bodyText) u.searchParams.set('body', bodyText);
      window.open(u.toString(), '_blank', 'noopener');
    } catch {
      const params = new URLSearchParams();
      if (to) params.set('to', to);
      if (cc) params.set('cc', cc);
      if (subject) params.set('subject', subject);
      if (bodyText) params.set('body', bodyText);
      const url = base + (base.includes('?') ? '&' : '?') + params.toString();
      window.open(url, '_blank', 'noopener');
    }
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (Number(timeSpentHours) < 0) throw new Error('업무 소요 시간(시간)은 0 이상이어야 합니다');
      if (![0, 10, 20, 30, 40, 50].includes(Number(timeSpentMinutes10))) throw new Error('업무 소요 시간(분)은 10분 단위로 선택해 주세요');
      const computedMinutes = (Number(timeSpentHours) || 0) * 60 + (Number(timeSpentMinutes10) || 0);
      const pidForPayload = (selectedProcInstId || processInstanceId);
      const tidForPayload = (selectedProcTaskId || taskInstanceId);
      const hasProcess = !!(pidForPayload && tidForPayload);
      const hasInit = !!String(initiativeId || '').trim();
      const hasTaskName = !!String(taskName || '').trim();
      if (!hasInit && !hasProcess && !hasTaskName) throw new Error('대상(initiativeId) 또는 신규 과제 제목 또는 프로세스 과제를 선택해 주세요');
      const baseNote = String(note || '').trim();
      const noteWithEmail = [baseNote, emailNoteBlock].filter(Boolean).join('\n\n');
      const payload: any = {
        initiativeId: hasInit ? String(initiativeId).trim() : undefined,
        taskName: !hasInit && !hasProcess && hasTaskName ? String(taskName).trim() : undefined,
        createdById,
        progressPct: Number(progressPct) || 0,
        timeSpentMinutes: computedMinutes,
        blockerCode: blockerCode || undefined,
        note: noteWithEmail || undefined,
        urgent: urgent || undefined,
        attachments: attachments.length ? { files: attachments } : undefined,
      };
      if (pidForPayload && tidForPayload) {
        payload.processInstanceId = pidForPayload;
        payload.taskInstanceId = tidForPayload;
      }
      if (approverId) {
        const dueAtIso = dueAt ? (/^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? `${dueAt}T00:00:00+09:00` : dueAt) : undefined;
        payload.report = { approverId, dueAt: dueAtIso };
      }
      const watcherIds = watchers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const externalRecipientEmailsList = externalRecipientEmails
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (watcherIds.length || externalRecipientEmailsList.length) {
        payload.share = { watcherIds, scope: 'COMMENT', ...(externalRecipientEmailsList.length ? { externalRecipientEmails: externalRecipientEmailsList } : {}) };
      }
      if (helpCategory || helpAssigneeId || helpQueue || helpSla !== '' || helpDueAt) {
        const helpDueAtIso = helpDueAt ? (/^\d{4}-\d{2}-\d{2}$/.test(helpDueAt) ? `${helpDueAt}T00:00:00+09:00` : helpDueAt) : undefined;
        payload.help = [
          {
            category: helpCategory,
            queue: helpQueue || undefined,
            assigneeId: helpAssigneeId || undefined,
            dueAt: helpDueAtIso,
            slaMinutes: helpSla === '' ? undefined : Number(helpSla),
          },
        ];
      }
      if (parentId && childInitiativeId && delegateeId) {
        payload.delegate = [
          {
            parentType,
            parentId,
            childInitiativeId,
            delegateeId,
            dueAt: delegateDueAt || undefined,
          },
        ];
      }

      const res = await apiFetch('/api/worklogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      const worklogId = data?.worklog?.id || data?.id;
      const createdInitiativeId = data?.worklog?.initiativeId || initiativeId;
      // If invoked from a process task or selected from dropdown, mark task as completed with linkage
      const pidAfter = (selectedProcInstId || processInstanceId);
      const tidAfter = (selectedProcTaskId || taskInstanceId);
      if (pidAfter && tidAfter && worklogId) {
        try {
          await apiFetch(`/api/processes/${encodeURIComponent(pidAfter)}/tasks/${encodeURIComponent(tidAfter)}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ worklogId }),
          });
        } catch {}
      }
      // 업무 지시에서 온 경우 지시 완료 처리
      if (paramInstructionId && worklogId) {
        try {
          await apiFetch(`/api/instructions/${encodeURIComponent(paramInstructionId)}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ worklogId, userId: createdById }),
          });
        } catch {}
      }
      // Optional: record progress entries
      if (initiativeDone && createdInitiativeId) {
        await apiFetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subjectType: 'INITIATIVE', subjectId: createdInitiativeId, actorId: createdById, worklogId, initiativeDone: true, note }),
        });
      }
      if (krId && (krValue !== '' || krAchieved)) {
        let valueToSend: number | null = null;
        if (krValue !== '') {
          valueToSend = Number(krValue);
        } else if (krAchieved) {
          try {
            const r = await apiFetch(`/api/okrs/krs/${encodeURIComponent(krId)}`);
            if (r.ok) {
              const d = await r.json();
              if (typeof d?.target === 'number') valueToSend = d.target;
            }
          } catch {}
        }
        if (valueToSend != null) {
          await apiFetch('/api/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subjectType: 'KR', subjectId: krId, actorId: createdById, worklogId, krValue: valueToSend, note }),
          });
        }
      }
      // 저장 완료 → AI 보완 질문/지식배지 심사 (모달에서 완료 후 이동)
      if (worklogId) { setAiFollowupId(worklogId); return; }
      nav('/search?mode=list');
    } catch (err: any) {
      setError(err.message || '에러가 발생했습니다');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
      {aiFollowupId && <WorklogAiFollowup worklogId={aiFollowupId} onDone={() => nav('/search?mode=list')} />}

      {instruction && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 16 }}>📌</span>
            <span style={{ fontWeight: 800, color: '#b91c1c', fontSize: 14 }}>업무 지시 완료를 위한 업무일지 작성</span>
          </div>
          <div style={{ fontSize: 13, color: '#7f1d1d', lineHeight: 1.5 }}>
            <div><strong>지시자:</strong> {instruction.assignerName}</div>
            <div><strong>지시 내용:</strong> {instruction.title}</div>
            {instruction.dueDate && <div><strong>마감일:</strong> {new Date(instruction.dueDate).toLocaleDateString()}</div>}
          </div>
          <div style={{ fontSize: 12, color: '#991b1b', marginTop: 6 }}>
            이 업무일지를 저장하면 업무 지시가 완료 처리됩니다.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', margin: 0 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} style={{ width: 20, height: 20 }} /> 긴급 보고
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input type="checkbox" checked={initiativeDone} onChange={(e) => setInitiativeDone(e.target.checked)} style={{ width: 20, height: 20 }} /> 과제 완료 처리
        </label>
      </div>

      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
        긴급 보고: 품질/설비/납기 등 즉시 공유가 필요한 이슈일 때 체크합니다.
        <br />
        과제 완료: 이번 업무일지로 해당 과제가 완료되었을 때 체크합니다. (과제 완료로 기록됩니다)
      </div>

      <div className="resp-2">
        <label>
          결재자 User ID(선택)
          <select value={approverId} onChange={(e) => setApproverId(e.target.value)}>
            <option value="">선택 안함</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
            ))}
          </select>
        </label>
        <label>
          결재 기한(ISO, 선택)
          <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label>
          업무 요청 카테고리(선택)
          <input value={helpCategory} onChange={(e) => setHelpCategory(e.target.value)} />
        </label>
        <label>
          업무 요청 담당자 User ID(선택)
          <select value={helpAssigneeId} onChange={(e) => setHelpAssigneeId(e.target.value)}>
            <option value="">선택 안함</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
            ))}
          </select>
        </label>
        <label>
          업무 요청 기한(ISO, 선택)
          <input type="date" value={helpDueAt} onChange={(e) => setHelpDueAt(e.target.value)} />
        </label>
        <label>
          할당 큐(선택)
          <input value={helpQueue} onChange={(e) => setHelpQueue(e.target.value)} />
        </label>
        <label>
          SLA(분, 선택)
          <input type="number" min={0} value={helpSla} onChange={(e) => setHelpSla(e.target.value === '' ? '' : Number(e.target.value))} />
        </label>
      </div>

      {instruction && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 12 }}>
          <label style={{ margin: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>📌</span>
              <span style={{ fontWeight: 700, color: '#b91c1c' }}>업무지시 과제</span>
            </span>
            <select disabled style={{ background: '#fff', width: '100%' }}>
              <option>{instruction.title || '업무 지시'} · {instruction.assignerName || '지시자'}</option>
            </select>
            <div style={{ fontSize: 12, color: '#991b1b', marginTop: 4 }}>
              업무지시에서 연결되었습니다. 이 업무일지를 저장하면 업무지시가 완료 처리됩니다.
            </div>
            {instruction.sourceWorklogId && (
              <div style={{ marginTop: 6 }}>
                <a
                  href={`/worklogs/${instruction.sourceWorklogId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#1d4ed8', textDecoration: 'underline' }}
                >
                  원본 업무일지 보기 →
                </a>
              </div>
            )}
          </label>
        </div>
      )}

      {(processInstanceId || myProcTasks.length > 0) && !instruction && (
        <label>
          프로세스 과제(선택)
          <select
            value={selectedProcTaskId}
            onChange={(e) => {
              const tid = e.target.value;
              setSelectedProcTaskId(tid);
              const found = myProcTasks.find((t) => t.id === tid);
              setSelectedProcInstId(found?.instance?.id || '');
            }}
            disabled={!!taskInstanceId}
          >
            <option value="">선택 안 함</option>
            {myProcTasks.map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {t.instance?.title || ''}</option>
            ))}
          </select>
          {!!taskInstanceId && <div style={{ fontSize: 12, color: '#6b7280' }}>프로세스에서 전달된 과제로 고정되었습니다.</div>}
          {!!(selectedProcInstId || processInstanceId) && (
            <div style={{ marginTop: 6 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowProcPopup(true)}>진행 프로세스 보기</button>
            </div>
          )}
        </label>
      )}

      <label>
        Initiative ID
        <input value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)} required={false} disabled={!!paramInitiativeId} />
        <div style={{ fontSize: 12, color: '#6b7280' }}>과제(initiative)는 목표관리(OKR/KPI)와 연동되는 업무 과제입니다. OKR/KPI에 등록된 과제를 연결할 때 사용합니다.</div>
        {!!paramInitiativeId && <div style={{ fontSize: 12, color: '#6b7280' }}>프로세스에서 전달된 과제로 고정되었습니다.</div>}
      </label>
      <label>
        신규 과제 제목(initiativeId 없이 작성)
        <input value={taskName} onChange={(e) => setTaskName(e.target.value)} disabled={!!paramInitiativeId || !!(selectedProcInstId && selectedProcTaskId)} />
        {!!(selectedProcInstId && selectedProcTaskId) && <div style={{ fontSize: 12, color: '#6b7280' }}>프로세스 과제를 선택한 경우 신규 과제는 자동으로 연결됩니다.</div>}
      </label>
      <label>
        작성자 User ID
        <input value={createdById} onChange={(e) => setCreatedById(e.target.value)} required />
      </label>

      <div className="resp-2">
        <label>
          진척(%)
          <input type="number" min={0} max={100} value={progressPct} onChange={(e) => setProgressPct(Number(e.target.value))} />
        </label>
        <label>
          업무시간
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" min={0} value={timeSpentHours} onChange={(e) => setTimeSpentHours(Math.max(0, Number(e.target.value) || 0))} style={{ width: 120 }} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>시간</span>
            <select value={timeSpentMinutes10} onChange={(e) => setTimeSpentMinutes10(Number(e.target.value))} style={{ appearance: 'auto' as any, width: 120 }}>
              {[0, 10, 20, 30, 40, 50].map((m) => (
                <option key={m} value={m}>{m}분</option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <label>
        차단 코드(optional)
        <input value={blockerCode} onChange={(e) => setBlockerCode(e.target.value)} />
      </label>
      <label>
        노트(optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        <div style={{ fontSize: 12, color: '#6b7280' }}>사진 입력은 빠른 작성(리치 모드)에서 편집기 이미지 버튼을 사용해 본문에 삽입해 주세요.</div>
      </label>

      {showEmailSection && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px', display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 700 }}>외부 메일(Outlook)</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>템플릿/프로세스 시작 입력값을 가이드로 채우고, 자유롭게 수정해서 사용하세요. 메일 내용은 업무일지 노트에 자동 입력됩니다.</div>
          <div className="resp-2">
            <label>
              To
              <input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="a@x.com; b@y.com" />
            </label>
            <label>
              Cc
              <input value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="c@x.com" />
            </label>
            <label>
              Subject
              <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
            </label>
          </div>
          <label>
            Body
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={6} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={openOutlookWebCompose} disabled={!hasVal(emailTo) && !hasVal(emailCc) && !hasVal(emailSubject) && !hasVal(emailBody)}>
              Outlook(웹) 열기
            </button>
            <span style={{ fontSize: 12, color: '#6b7280' }}>메일 내용은 저장 시 업무일지 노트에 자동 반영됩니다.</span>
          </div>
          {!!emailNoteBlock && (
            <div style={{ background: '#f8fafc', border: '1px dashed #cbd5f5', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>노트 자동 입력 미리보기</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{emailNoteBlock}</pre>
            </div>
          )}
        </div>
      )}

      <h3>성과 입력(선택)</h3>
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.45 }}>
        목표 달성(달성값) 입력: 선택한 OKR/KPI 지표(KR)의 실적을 기록할 때 사용합니다. 숫자를 입력하거나, “목표 달성”을 체크하면 목표값이 자동으로 기록됩니다.
      </div>
      <div className="resp-2">
        <label>
          KR ID(optional)
          <input value={krId} onChange={(e) => setKrId(e.target.value)} placeholder="선택 과제의 KR ID" />
        </label>
        <label>
          지표값(optional)
          <input type="number" step="any" value={krValue} onChange={(e) => setKrValue(e.target.value)} />
        </label>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={krAchieved} onChange={(e) => setKrAchieved(e.target.checked)} /> 목표 달성으로 기록(목표값 자동 입력)
        </label>
      </div>

      <h3>첨부(링크)</h3>
      <div style={{
        marginTop: 4,
        marginBottom: 8,
        padding: '10px 12px',
        background: '#EFF6FF',
        border: '1px solid #BFDBFE',
        borderRadius: 10,
        fontSize: 12.5,
        color: '#1E3A8A',
        lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>📌 첨부 안내</div>
        사진·파일은 <b>먼저 OneDrive(회사 SharePoint)</b>에 업로드한 뒤,
        해당 파일의 <b>공유 링크</b>를 복사해 아래에 붙여넣어 주세요.
        <br />
        <b>링크 추가</b> 버튼을 누르면 아래에서 선택한 <b>공유 범위</b>로 자동 재설정됩니다.
        <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="radio" name="wnShareScope" value="organization" checked={shareScope === 'organization'} onChange={() => setShareScope('organization')} />
            <span>회사 내부(로그인 필요) — 권장</span>
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="radio" name="wnShareScope" value="anonymous" checked={shareScope === 'anonymous'} onChange={() => setShareScope('anonymous')} />
            <span>링크가 있는 모든 사용자</span>
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="radio" name="wnShareScope" value="skip" checked={shareScope === 'skip'} onChange={() => setShareScope('skip')} />
            <span>변경 없음</span>
          </label>
        </div>
        <div style={{ marginTop: 4 }}>서버에 파일을 직접 올리지 않습니다. 회사 OneDrive 링크(<code>cams2002-my.sharepoint.com</code>)만 허용됩니다.</div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={attachUrl}
          onChange={(e) => setAttachUrl(e.target.value)}
          placeholder="Teams/OneDrive 공유 링크를 붙여넣으세요"
          style={{ flex: 1, minWidth: 240 }}
        />
        <button
          type="button"
          className="btn"
          onClick={async () => {
            const raw = String(attachUrl || '').trim();
            if (!raw) return;
            if (!/^https?:\/\//i.test(raw)) {
              setError('첨부 링크는 http(s) 주소여야 합니다.');
              return;
            }

            try {
              const u = new URL(raw);
              const h = String(u.hostname || '').toLowerCase();
              const allowed = h === 'cams2002-my.sharepoint.com' || h.endsWith('.cams2002-my.sharepoint.com') || h === '1drv.ms';
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

            // Upgrade to the user-selected share scope. 'skip' leaves the
            // URL as-is (assumes the user already configured sharing).
            let finalUrl = raw;
            let finalName = raw;
            if (shareScope !== 'skip') {
              try {
                const resp = await apiFetch('/api/graph-tasks/onedrive/anon-link-from-url', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: myUserId, url: raw, scope: shareScope }),
                });
                if (resp.ok) {
                  const data: any = await resp.json().catch(() => ({}));
                  if (data?.url) finalUrl = String(data.url);
                  if (data?.name) finalName = String(data.name);
                  if (data?.scope && data.scope !== shareScope && data.scope !== 'passthrough') {
                    window.alert(
                      `주의: 선택한 공유 범위(${shareScope})로 설정하지 못했습니다 ` +
                      `(적용된 범위=${data.scope}).`,
                    );
                  }
                } else {
                  const err: any = await resp.json().catch(() => ({}));
                  const msg = err?.message || `HTTP ${resp.status}`;
                  const cont = window.confirm(
                    `공유 설정 자동 변경에 실패했습니다: ${msg}\n원본 링크 그대로 첨부할까요?`,
                  );
                  if (!cont) return;
                }
              } catch (e: any) {
                const cont = window.confirm(
                  `공유 설정 자동 변경 중 오류: ${e?.message || e}\n원본 링크 그대로 첨부할까요?`,
                );
                if (!cont) return;
              }
            }

            setAttachments((prev) => [...prev, { url: finalUrl, name: finalName }]);
            setAttachUrl('');
          }}
          disabled={!String(attachUrl || '').trim()}
        >
          링크 추가
        </button>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#64748b' }}>
        <input type="checkbox" checked={attachOneDriveOk} onChange={(e) => setAttachOneDriveOk(e.target.checked)} />
        원드라이브/Teams 링크만 첨부합니다
      </label>
      {attachments.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          {attachments.map((a, i) => (
            <div key={`${a.url}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <a className="file-link" href={a.url} target="_blank" rel="noreferrer" download={a.name || undefined}>{a.name || a.url}</a>
              <button type="button" className="btn btn-danger" onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}>삭제</button>
            </div>
          ))}
        </div>
      )}

      

      <h3>공유 옵션</h3>
      <label>
        워처 User ID들(쉼표 구분)
        <input value={watchers} onChange={(e) => setWatchers(e.target.value)} placeholder="u1,u2" />
      </label>

      <label>
        외부 수신 이메일들(쉼표 구분)
        <input value={externalRecipientEmails} onChange={(e) => setExternalRecipientEmails(e.target.value)} placeholder="a@x.com,b@y.com" />
      </label>

      

      <h3>위임 옵션(단일)</h3>
      <div className="resp-2">
        <label>
          Parent Type
          <input value={parentType} onChange={(e) => setParentType(e.target.value)} />
        </label>
        <label>
          Parent ID
          <input value={parentId} onChange={(e) => setParentId(e.target.value)} />
        </label>
        <label>
          Child Initiative ID
          <input value={childInitiativeId} onChange={(e) => setChildInitiativeId(e.target.value)} />
        </label>
        <label>
          Delegatee User ID
          <input value={delegateeId} onChange={(e) => setDelegateeId(e.target.value)} />
        </label>
        <label>
          DueAt (ISO optional)
          <input value={delegateDueAt} onChange={(e) => setDelegateDueAt(e.target.value)} placeholder="2025-10-16T09:00:00Z" />
        </label>
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}
      <LoadingButton loading={submitting} type="submit">업무일지 저장</LoadingButton>

      {showProcPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 0, width: 'min(1080px, 96vw)', height: 'min(85vh, 900px)', display: 'grid', gridTemplateRows: '44px 1fr' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontWeight: 700 }}>프로세스 진행 대시보드</div>
              <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => setShowProcPopup(false)}>닫기</button>
            </div>
            <iframe
              title="process-detail"
              src={`/process/instances/${encodeURIComponent(selectedProcInstId || processInstanceId)}`}
              style={{ width: '100%', height: '100%', border: 'none' }}
            />
          </div>
        </div>
      )}
    </form>
  );
}
