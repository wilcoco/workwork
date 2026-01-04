import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

interface UserMe { id: string; name: string; role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'; }

interface ProcTaskLite {
  id: string;
  stageLabel?: string | null;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  status: string;
}

interface AssigneeAgg {
  id: string;
  name: string;
  counts: { total: number; completed: number; inProgress: number; ready: number; notStarted: number; skipped: number; overdue: number };
}

interface ProcInstLite {
  id: string;
  title: string;
  status: string;
  startAt: string;
  expectedEndAt?: string;
  endAt?: string;
  template?: { id: string; title: string };
  startedBy?: { id: string; name: string; role: string };
  initiative?: { id: string; title: string };
  delayed?: boolean;
  tasks: ProcTaskLite[];
  assignees?: AssigneeAgg[];
}

export function ProcessDashboard() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [me, setMe] = useState<UserMe | null>(null);
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'SUSPENDED' | 'ABORTED' | 'COMPLETED'>('ACTIVE');
  const [delayedOnly, setDelayedOnly] = useState(false);
  const [items, setItems] = useState<ProcInstLite[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (userId) {
          const mine = await apiJson<UserMe>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
          setMe(mine);
        }
      } catch {}
    })();
  }, [userId]);

  async function load() {
    setLoading(true);
    try {
      const qs = status === 'ALL' ? '' : `?status=${encodeURIComponent(status)}`;
      const rows = await apiJson<ProcInstLite[]>(`/api/processes${qs}`);
      setItems(rows || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  const filtered = useMemo(() => {
    return items.filter((it) => (delayedOnly ? !!it.delayed : true));
  }, [items, delayedOnly]);

  const canExec = (inst: ProcInstLite) => {
    const role = String(me?.role || '').toUpperCase();
    if (role === 'CEO' || role === 'EXEC') return true;
    if (me && inst.startedBy?.id === me.id) return true;
    return false;
  };

  const fmt = (s?: string) => (s ? new Date(s).toLocaleString() : '');

  async function stop(inst: ProcInstLite) {
    if (!me) return;
    const reason = window.prompt('중단 사유를 입력하세요 (필수)');
    if (!reason) return;
    const abort = window.confirm('완전 중단(ABORTED)?\n확인: ABORTED (재개 불가) / 취소: SUSPENDED (일시 중단)');
    const stopType = abort ? 'ABORTED' : 'SUSPENDED';
    await apiJson(`/api/processes/${encodeURIComponent(inst.id)}/stop`, {
      method: 'POST',
      body: JSON.stringify({ actorId: me.id, stopType, reason }),
    });
    await load();
  }

  async function resume(inst: ProcInstLite) {
    if (!me) return;
    const reason = window.prompt('재개 사유를 입력하세요 (선택)') || '';
    await apiJson(`/api/processes/${encodeURIComponent(inst.id)}/resume`, {
      method: 'POST',
      body: JSON.stringify({ actorId: me.id, reason }),
    });
    await load();
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>프로세스 진행 대시보드</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          상태
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="ALL">ALL</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="ABORTED">ABORTED</option>
            <option value="COMPLETED">COMPLETED</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={delayedOnly} onChange={(e) => setDelayedOnly(e.target.checked)} />
          지연만 보기
        </label>
        <button className="btn" onClick={load} disabled={loading}>새로고침</button>
      </div>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 1.2fr 1fr 1fr 0.6fr 2fr 1fr', gap: 0, fontWeight: 700, background: '#f8fafc', padding: '8px 10px' }}>
          <div>프로세스</div>
          <div>템플릿</div>
          <div>시작자</div>
          <div>시작</div>
          <div>예상완료</div>
          <div>지연</div>
          <div>담당자 진행</div>
          <div>액션</div>
        </div>
        {filtered.map((it) => (
          <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 1.2fr 1fr 1fr 0.6fr 2fr 1fr', gap: 0, padding: '8px 10px', borderTop: '1px solid #eef2f7', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{it.title}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{it.status}</div>
              {it.initiative?.title && <div style={{ fontSize: 12, color: '#6b7280' }}>과제: {it.initiative.title}</div>}
            </div>
            <div>{it.template?.title || ''}</div>
            <div>{it.startedBy?.name || ''}</div>
            <div>{fmt(it.startAt)}</div>
            <div>{fmt(it.expectedEndAt)}</div>
            <div>{it.delayed ? '🔴' : ''}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(it.assignees || []).map((a) => (
                <div key={a.id} style={{ fontSize: 12, color: '#334155' }}>
                  <b>{a.name}</b> · 완료 {a.counts.completed}/{a.counts.total}
                  {a.counts.inProgress ? ` · 진행 ${a.counts.inProgress}` : ''}
                  {a.counts.ready ? ` · 대기 ${a.counts.ready}` : ''}
                  {a.counts.overdue ? ` · 지연 ${a.counts.overdue}` : ''}
                </div>
              ))}
              {!(it.assignees || []).length && <div style={{ fontSize: 12, color: '#94a3b8' }}>담당자 없음</div>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {it.status === 'ACTIVE' && canExec(it) && (
                <button className="btn btn-warning" onClick={() => stop(it)}>중단</button>
              )}
              {it.status === 'SUSPENDED' && canExec(it) && (
                <button className="btn btn-primary" onClick={() => resume(it)}>재개</button>
              )}
            </div>
          </div>
        ))}
        {!filtered.length && (
          <div style={{ padding: 12, fontSize: 12, color: '#9ca3af' }}>표시할 데이터가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
