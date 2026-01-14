import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

export function WorklogNew() {
  const nav = useNavigate();
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const processInstanceId = params?.get('processInstanceId') || '';
  const taskInstanceId = params?.get('taskInstanceId') || '';
  const paramInitiativeId = params?.get('initiativeId') || '';
  const [initiativeId, setInitiativeId] = useState(paramInitiativeId);
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

  // follow-up actions
  const [approverId, setApproverId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [watchers, setWatchers] = useState(''); // comma-separated userIds

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
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName: string }>>([]);
  const [myProcTasks, setMyProcTasks] = useState<Array<{ id: string; name: string; instance: { id: string; title: string } }>>([]);
  const [selectedProcTaskId, setSelectedProcTaskId] = useState<string>(taskInstanceId || '');
  const [selectedProcInstId, setSelectedProcInstId] = useState<string>(processInstanceId || '');
  const [showProcPopup, setShowProcPopup] = useState(false);

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
      const payload: any = {
        initiativeId,
        createdById,
        progressPct: Number(progressPct) || 0,
        timeSpentMinutes: computedMinutes,
        blockerCode: blockerCode || undefined,
        note: note || undefined,
        urgent: urgent || undefined,
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
      if (watcherIds.length) {
        payload.share = { watcherIds, scope: 'COMMENT' };
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
      // Optional: record progress entries
      if (initiativeDone) {
        await apiFetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subjectType: 'INITIATIVE', subjectId: initiativeId, actorId: createdById, worklogId, initiativeDone: true, note }),
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
      nav('/search?mode=list');
    } catch (err: any) {
      setError(err.message || '에러가 발생했습니다');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, maxWidth: 720 }}>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', margin: 0 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} style={{ width: 20, height: 20 }} /> 긴급 보고
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input type="checkbox" checked={initiativeDone} onChange={(e) => setInitiativeDone(e.target.checked)} style={{ width: 20, height: 20 }} /> 과제 완료 처리
        </label>
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

      {(processInstanceId || myProcTasks.length > 0) && (
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
        <input value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)} required={!(selectedProcInstId && selectedProcTaskId)} disabled={!!paramInitiativeId} />
        {!!paramInitiativeId && <div style={{ fontSize: 12, color: '#6b7280' }}>프로세스에서 전달된 과제로 고정되었습니다.</div>}
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
      </label>

      <h3>성과 입력(선택)</h3>
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

      

      <h3>공유 옵션</h3>
      <label>
        워처 User ID들(쉼표 구분)
        <input value={watchers} onChange={(e) => setWatchers(e.target.value)} placeholder="u1,u2" />
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
      <button disabled={submitting} type="submit">{submitting ? '저장 중...' : '업무일지 저장'}</button>

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
