import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

export function WorklogNew() {
  const nav = useNavigate();
  const [initiativeId, setInitiativeId] = useState('');
  const [createdById, setCreatedById] = useState('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [timeSpentMinutes, setTimeSpentMinutes] = useState<number>(0);
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: any = {
        initiativeId,
        createdById,
        progressPct: Number(progressPct) || 0,
        timeSpentMinutes: Number(timeSpentMinutes) || 0,
        blockerCode: blockerCode || undefined,
        note: note || undefined,
        urgent: urgent || undefined,
      };
      if (approverId) {
        payload.report = { approverId, dueAt: dueAt || undefined };
      }
      const watcherIds = watchers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (watcherIds.length) {
        payload.share = { watcherIds, scope: 'COMMENT' };
      }
      if (helpCategory) {
        payload.help = [
          {
            category: helpCategory,
            queue: helpQueue || undefined,
            assigneeId: helpAssigneeId || undefined,
            dueAt: helpDueAt || undefined,
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
      <h2>업무일지 작성</h2>

      <div className="resp-2">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={initiativeDone} onChange={(e) => setInitiativeDone(e.target.checked)} /> 과제 완료 처리
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 긴급 보고
        </label>
      </div>

      <div className="resp-2">
        <label>
          결재자 User ID(선택)
          <input value={approverId} onChange={(e) => setApproverId(e.target.value)} />
        </label>
        <label>
          결재 기한(ISO, 선택)
          <input value={dueAt} onChange={(e) => setDueAt(e.target.value)} placeholder="2025-10-15T09:00:00Z" />
        </label>
        <label>
          협조 카테고리(선택)
          <input value={helpCategory} onChange={(e) => setHelpCategory(e.target.value)} />
        </label>
        <label>
          협조 담당자 User ID(선택)
          <input value={helpAssigneeId} onChange={(e) => setHelpAssigneeId(e.target.value)} />
        </label>
        <label>
          협조 기한(ISO, 선택)
          <input value={helpDueAt} onChange={(e) => setHelpDueAt(e.target.value)} placeholder="2025-10-16T09:00:00Z" />
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

      <label>
        Initiative ID
        <input value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)} required />
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
          소요시간(분)
          <input type="number" min={0} value={timeSpentMinutes} onChange={(e) => setTimeSpentMinutes(Number(e.target.value))} />
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
    </form>
  );
}
