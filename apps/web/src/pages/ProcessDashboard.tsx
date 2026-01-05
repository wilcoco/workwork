import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

interface UserMe { id: string; name: string; role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL'; }

interface ProcTaskLite {
  id: string;
  name?: string;
  stageLabel?: string | null;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  status: string;
  assigneeId?: string;
  assignee?: { id: string; name: string; orgName?: string } | null;
  plannedStartAt?: string;
  plannedEndAt?: string;
  actualStartAt?: string;
  actualEndAt?: string;
  deadlineAt?: string;
}

interface AssigneeAgg {
  id: string;
  name: string;
  orgUnitId?: string;
  orgName?: string;
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
  const [orgFilter, setOrgFilter] = useState<string>('');
  const [assigneeSort, setAssigneeSort] = useState<'OVERDUE_DESC' | 'RATE_ASC' | 'NAME_ASC'>('OVERDUE_DESC');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const orgOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      for (const a of (it.assignees || [])) {
        const name = a.orgName || '';
        if (name) set.add(name);
      }
    }
    return Array.from(set).sort();
  }, [items]);

  const sortAssignees = (arr: AssigneeAgg[]) => {
    const copy = [...arr];
    if (assigneeSort === 'OVERDUE_DESC') {
      copy.sort((a, b) => (b.counts.overdue - a.counts.overdue) || (b.counts.inProgress - a.counts.inProgress));
    } else if (assigneeSort === 'RATE_ASC') {
      const rate = (x: AssigneeAgg) => (x.counts.total ? x.counts.completed / x.counts.total : 1);
      copy.sort((a, b) => rate(a) - rate(b));
    } else if (assigneeSort === 'NAME_ASC') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    }
    return copy;
  };

  const canExec = (inst: ProcInstLite) => {
    const role = String(me?.role || '').toUpperCase();
    if (role === 'CEO' || role === 'EXEC') return true;
    if (me && inst.startedBy?.id === me.id) return true;
    return false;
  };

  const fmt = (s?: string) => (s ? new Date(s).toLocaleString() : '');
  const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString() : '');

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

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          담당자 조직 필터
          <select value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
            <option value="">전체</option>
            {orgOptions.map((o) => (<option key={o} value={o}>{o}</option>))}
          </select>
        </label>
        <label>
          담당자 정렬
          <select value={assigneeSort} onChange={(e) => setAssigneeSort(e.target.value as any)}>
            <option value="OVERDUE_DESC">지연 많은 순</option>
            <option value="RATE_ASC">완료율 낮은 순</option>
            <option value="NAME_ASC">이름순</option>
          </select>
        </label>
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
            <div style={{ display: 'grid', gap: 6 }}>
              {(() => {
                const list = (it.assignees || []);
                const filteredAssignees = list.filter(a => !orgFilter || a.orgName === orgFilter);
                if (!filteredAssignees.length) return <div style={{ fontSize: 12, color: '#94a3b8' }}>담당자 없음</div>;
                // 그룹핑 by org
                const byOrg = new Map<string, AssigneeAgg[]>();
                for (const a of filteredAssignees) {
                  const k = a.orgName || '미지정팀';
                  if (!byOrg.has(k)) byOrg.set(k, []);
                  byOrg.get(k)!.push(a);
                }
                return Array.from(byOrg.entries()).map(([org, arr]) => {
                  const sorted = sortAssignees(arr);
                  return (
                    <div key={org} style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{org}</div>
                      {sorted.map((a) => {
                        const total = a.counts.total || 0;
                        const done = a.counts.completed || 0;
                        const prog = a.counts.inProgress || 0;
                        const ready = a.counts.ready || 0;
                        const pct = total ? Math.round((done / total) * 100) : 100;
                        return (
                          <div key={a.id} style={{ display: 'grid', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#334155' }}>
                              <b>{a.name}</b>
                              <span style={{ background: '#DCFCE7', color: '#166534', borderRadius: 999, padding: '0 6px' }}>완료 {done}/{total}</span>
                              {prog ? <span style={{ background: '#DBEAFE', color: '#1E3A8A', borderRadius: 999, padding: '0 6px' }}>진행 {prog}</span> : null}
                              {ready ? <span style={{ background: '#F1F5F9', color: '#334155', borderRadius: 999, padding: '0 6px' }}>대기 {ready}</span> : null}
                              {a.counts.overdue ? <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 999, padding: '0 6px' }}>지연 {a.counts.overdue}</span> : null}
                            </div>
                            <div style={{ width: '100%', height: 8, background: '#EEF2F7', borderRadius: 999, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: '#22C55E' }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {it.status === 'ACTIVE' && canExec(it) && (
                <button className="btn btn-warning" onClick={() => stop(it)}>중단</button>
              )}
              {it.status === 'SUSPENDED' && canExec(it) && (
                <button className="btn btn-primary" onClick={() => resume(it)}>재개</button>
              )}
              <button className="btn" onClick={() => setExpanded((prev) => ({ ...prev, [it.id]: !prev[it.id] }))}>
                {expanded[it.id] ? '세부 접기' : '세부 보기'}
              </button>
            </div>
            {expanded[it.id] && (
              <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr 1fr 1fr 1fr 1fr 0.9fr', background: '#f9fafb', padding: '6px 8px', fontWeight: 600, fontSize: 12 }}>
                    <div>단계/과제</div>
                    <div>담당자</div>
                    <div>계획시작</div>
                    <div>계획완료</div>
                    <div>실착수</div>
                    <div>실완료</div>
                    <div>상태</div>
                  </div>
                  {(it.tasks || []).map((t) => (
                    <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr 1fr 1fr 1fr 1fr 0.9fr', padding: '6px 8px', borderTop: '1px solid #eef2f7', fontSize: 12, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{t.name || '-'}</div>
                        {t.stageLabel ? <div style={{ color: '#6b7280' }}>{t.stageLabel}</div> : null}
                      </div>
                      <div>{t.assignee?.name || '-'}</div>
                      <div>{fmtDate(t.plannedStartAt)}</div>
                      <div>{fmtDate(t.plannedEndAt)}</div>
                      <div>{fmtDate(t.actualStartAt)}</div>
                      <div>{fmtDate(t.actualEndAt)}</div>
                      <div>{t.status}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {!filtered.length && (
          <div style={{ padding: 12, fontSize: 12, color: '#9ca3af' }}>표시할 데이터가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
