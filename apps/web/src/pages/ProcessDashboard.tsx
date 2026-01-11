import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { BpmnMiniView } from '../components/BpmnMiniView';
import { toSafeHtml } from '../lib/richText';

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
  const [detailMap, setDetailMap] = useState<Record<string, any>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});

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
  const nextTasks = (it: ProcInstLite) => (it.tasks || []).filter((t) => String(t.status).toUpperCase() === 'READY');

  async function ensureDetail(id: string) {
    if (detailMap[id] || detailLoading[id]) return;
    setDetailLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const d = await apiJson<any>(`/api/processes/${encodeURIComponent(id)}`);
      console.log('ensureDetail response:', id, d);
      setDetailMap((prev) => ({ ...prev, [id]: d }));
    } catch (err) {
      console.error('ensureDetail error:', id, err);
    }
    finally {
      setDetailLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  const parsePreds = (s?: string | null): string[] => {
    if (!s) return [];
    return String(s).split(',').map(x => x.trim()).filter(Boolean);
  };

  const statusBadge = (s: string) => {
    const u = String(s).toUpperCase();
    if (u === 'COMPLETED') return { bg: '#DCFCE7', fg: '#166534' };
    if (u === 'IN_PROGRESS') return { bg: '#DBEAFE', fg: '#1E3A8A' };
    if (u === 'READY') return { bg: '#E0F2FE', fg: '#075985' };
    if (u === 'CHAIN_WAIT' || u === 'NOT_STARTED') return { bg: '#F1F5F9', fg: '#334155' };
    if (u === 'SKIPPED') return { bg: '#F8FAFC', fg: '#64748b', border: '#E5E7EB' } as any;
    return { bg: '#F1F5F9', fg: '#334155' };
  };

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
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 1.2fr 1fr 1fr 0.6fr 1.6fr 2fr 1fr', gap: 0, fontWeight: 700, background: '#f8fafc', padding: '8px 10px' }}>
          <div>프로세스</div>
          <div>템플릿</div>
          <div>시작자</div>
          <div>시작</div>
          <div>예상완료</div>
          <div>지연</div>
          <div>다음 할 일</div>
          <div>담당자 진행</div>
          <div>액션</div>
        </div>
        {filtered.map((it) => (
          <div key={it.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.6fr 1.2fr 1fr 1fr 0.6fr 1.6fr 2fr 1fr', gap: 0, padding: '8px 10px', borderTop: '1px solid #eef2f7', alignItems: 'center' }}>
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
            <div style={{ display: 'grid', gap: 4 }}>
              {(() => {
                const next = nextTasks(it);
                if (!next.length) return <div style={{ fontSize: 12, color: '#94a3b8' }}>표시할 작업 없음</div>;
                return next.map((t) => (
                  <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ fontWeight: 600 }}>{t.name || t.stageLabel || '-'}</span>
                    <span style={{ color: '#6b7280' }}>·</span>
                    <span style={{ background: '#F1F5F9', color: '#334155', borderRadius: 999, padding: '0 6px' }}>{t.assignee?.name || '담당 미지정'}</span>
                  </div>
                ));
              })()}
            </div>
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
              <button className="btn" onClick={() => { const willOpen = !expanded[it.id]; setExpanded((prev) => ({ ...prev, [it.id]: willOpen })); if (willOpen) ensureDetail(it.id); }}>
                {expanded[it.id] ? '세부 접기' : '세부 보기'}
              </button>
            </div>
            {expanded[it.id] && (
              <div style={{ gridColumn: '1 / -1', marginTop: 8, display: 'grid', gap: 10 }}>
                {(() => {
                  const d = detailMap[it.id];
                  if (d?.template?.description) {
                    return (
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 8 }}>프로세스 설명</div>
                        <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(d.template.description) }} />
                      </div>
                    );
                  }
                  return null;
                })()}
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', background: '#f9fafb', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #e5e7eb' }}>업무 흐름도</div>
                  {detailLoading[it.id] ? (
                    <div style={{ padding: 10, fontSize: 12, color: '#64748b' }}>불러오는 중…</div>
                  ) : (
                    (() => {
                      const d = detailMap[it.id];
                      if (!d?.template?.bpmnJson) return <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>BPMN 정보가 없습니다.</div>;
                      return <div style={{ padding: 12 }}><BpmnMiniView bpmn={d.template.bpmnJson} height={400} /></div>;
                    })()
                  )}
                </div>
                {(() => {
                  const d = detailMap[it.id];
                  const tmplTasks = (d?.template?.tasks || []) as any[];
                  if (!tmplTasks.length) return null;
                  return (
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>노드별 설명</div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {tmplTasks.map((tt: any) => (
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
                    </div>
                  );
                })()}
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '6px 8px', background: '#f9fafb', fontWeight: 700, fontSize: 12 }}>과제 진행 현황</div>
                  {detailLoading[it.id] && <div style={{ padding: 10, fontSize: 12, color: '#64748b' }}>불러오는 중…</div>}
                  {!detailLoading[it.id] && (() => {
                    const d = detailMap[it.id];
                    if (!d) return <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>상세 정보가 없습니다.</div>;
                    const tmplTasks = ((d.template?.tasks || []) as any[]).slice().sort((a, b) => (Number(a.orderHint || 0) - Number(b.orderHint || 0)));
                    if (!tmplTasks.length) return <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>템플릿 태스크가 없습니다.</div>;
                    const seqMap = new Map<string, number>();
                    tmplTasks.forEach((t: any, idx: number) => seqMap.set(String(t.id), idx + 1));
                    const group = new Map<string, any[]>();
                    for (const t of (d.tasks || [])) {
                      const arr = group.get(t.taskTemplateId) || [];
                      arr.push(t);
                      group.set(t.taskTemplateId, arr);
                    }
                    return (
                      <div>
                        <div style={{ display: 'grid', gridTemplateColumns: '0.5fr 1.6fr 1fr 1.2fr 3fr', padding: '6px 8px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid #eef2f7' }}>
                          <div>#</div>
                          <div>단계/태스크</div>
                          <div>유형</div>
                          <div>선행</div>
                          <div>담당 체인</div>
                        </div>
                        {tmplTasks.map((tt: any) => {
                          const idx = seqMap.get(String(tt.id)) || 0;
                          const preds = parsePreds(tt.predecessorIds);
                          const predNums = preds.map((pid: string) => seqMap.get(String(pid)) || 0).filter(Boolean).sort((a, b) => a - b);
                          const mode = String(tt.predecessorMode || 'ALL').toUpperCase();
                          const line = (group.get(tt.id) || []).slice().sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                          // compute predecessor satisfaction based on instance tasks (same as backend semantics)
                          const predBlocks: number[] = [];
                          if (preds.length) {
                            if (mode === 'ANY') {
                              // at least one predecessor template has a COMPLETED instance
                              const anyOk = preds.some((pid: string) => (group.get(pid) || []).some((ins: any) => ['COMPLETED'].includes(String(ins.status).toUpperCase())));
                              if (!anyOk) {
                                // all are blocking → show all pred numbers
                                predBlocks.push(...predNums);
                              }
                            } else {
                              // ALL: every instance of each predecessor template must be COMPLETED or SKIPPED
                              for (const pid of preds) {
                                const arr = (group.get(pid) || []) as any[];
                                if (!arr.length) { predBlocks.push(seqMap.get(String(pid)) || 0); continue; }
                                const allDone = arr.every((ins: any) => ['COMPLETED','SKIPPED'].includes(String(ins.status).toUpperCase()));
                                if (!allDone) predBlocks.push(seqMap.get(String(pid)) || 0);
                              }
                            }
                          }
                          return (
                            <div key={tt.id} style={{ display: 'grid', gridTemplateColumns: '0.5fr 1.6fr 1fr 1.2fr 3fr', padding: '6px 8px', borderTop: '1px solid #eef2f7', fontSize: 12, alignItems: 'center' }}>
                              <div>{idx}</div>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ fontWeight: 600 }}>{tt.name || '-'}</div>
                                {tt.stageLabel ? <div style={{ color: '#6b7280' }}>{tt.stageLabel}</div> : null}
                              </div>
                              <div>
                                <span style={{ background: tt.taskType === 'WORKLOG' ? '#FEF9C3' : '#F1F5F9', color: '#334155', borderRadius: 999, padding: '0 6px' }}>{tt.taskType}</span>
                              </div>
                              <div style={{ color: '#475569', display: 'grid', gap: 2 }}>
                                {predNums.length ? `${predNums.join(', ')} (${mode})` : '-'}
                                {predBlocks.length ? (
                                  <div style={{ fontSize: 11, color: '#b91c1c' }}>미완료 선행: {predBlocks.sort((a,b)=>a-b).join(', ')}</div>
                                ) : null}
                              </div>
                              <div style={{ display: 'grid', gap: 4 }}>
                                {line.length ? line.map((ins: any) => {
                                  const st = statusBadge(ins.status);
                                  const a = (it.assignees || []).find(x => x.id === ins.assigneeId);
                                  const isMe = me && a?.id === me.id;
                                  return (
                                    <div key={ins.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: st.bg, color: st.fg, borderRadius: 6, padding: '4px 8px', border: (st as any).border ? `1px solid ${(st as any).border}` : '1px solid transparent' }}>
                                      <span style={{ width: 6, height: 6, borderRadius: 999, background: st.fg, display: 'inline-block' }} />
                                      <span style={{ fontWeight: 600 }}>{a?.name || '담당 미지정'}</span>
                                      <span style={{ color: '#6b7280', fontSize: 11 }}>계획: {fmtDate(ins.plannedStartAt)} ~ {fmtDate(ins.plannedEndAt)}</span>
                                      {ins.actualEndAt && <span style={{ color: '#059669', fontSize: 11 }}>완료: {fmtDate(ins.actualEndAt)}</span>}
                                      <span style={{ opacity: 0.8 }}>{String(ins.status)}</span>
                                      {isMe ? <span style={{ background: '#0EA5E9', color: 'white', borderRadius: 6, padding: '0 4px', fontSize: 10 }}>ME</span> : null}
                                    </div>
                                  );
                                }) : <span style={{ fontSize: 12, color: '#94a3b8' }}>체인 없음</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
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
