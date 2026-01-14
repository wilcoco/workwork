import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { apiJson } from '../lib/api';
import { toSafeHtml } from '../lib/richText';
import { UserPicker, type PickedUser } from '../components/UserPicker';
import { WorklogDocument } from '../components/WorklogDocument';

interface ProcTask {
  id: string;
  name: string;
  stageLabel?: string | null;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  status: string;
  deadlineAt?: string;
  actualEndAt?: string;
  assigneeId?: string;
  plannedStartAt?: string;
  plannedEndAt?: string;
}
interface ProcInst {
  id: string;
  title: string;
  status: string;
  startAt: string;
  expectedEndAt?: string;
  endAt?: string;
  itemCode?: string;
  moldCode?: string;
  carModelCode?: string;
  initiativeId?: string;
  template: { id: string; title: string };
  tasks: ProcTask[];
}

interface UserMe { id: string; name: string; role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' };
type ModChange = { type: 'skip' | 'reassign' | 'update'; taskId: string; name: string; before?: any; after?: any };
type ModEntry = { ts: string; userId: string; reason: string; changes: ModChange[] };
type TimelineItem = {
  id: string;
  name: string;
  stageLabel?: string | null;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  status: string;
  actualStartAt?: string;
  actualEndAt?: string;
  worklog?: { id: string; title: string; createdAt?: string; createdBy?: { id: string; name: string } | null; contentHtml?: string | null; note?: string | null } | null;
  cooperation?: {
    id: string;
    category?: string;
    status?: string;
    assignee?: { id: string; name: string } | null;
    dueAt?: string;
    worklog?: { id: string; title: string; createdAt?: string; createdBy?: { id: string; name: string } | null; contentHtml?: string | null; note?: string | null } | null;
  } | null;
  approval?: {
    id: string;
    status?: string;
    requestedBy?: { id: string; name: string } | null;
    dueAt?: string;
    steps?: Array<{ stepNo: number; approverId: string; status: string; actedAt?: string; comment?: string | null }>;
  } | null;
};

export function ProcessInstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const loc = useLocation();
  const [inst, setInst] = useState<ProcInst | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [me, setMe] = useState<UserMe | null>(null);
  const [showModify, setShowModify] = useState(false);
  const [modifyReason, setModifyReason] = useState('');
  const [userPickForTask, setUserPickForTask] = useState<string | null>(null);
  const [modRows, setModRows] = useState<Record<string, {
    skip?: boolean;
    assigneeId?: string;
    assigneeName?: string;
    stageLabel?: string | null;
    deadlineAt?: string;
    plannedStartAt?: string;
    plannedEndAt?: string;
  }>>({});
  const [modHistory, setModHistory] = useState<ModEntry[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);

  useEffect(() => {
    if (!id || id === 'undefined' || id === 'null') { setInst(null); setError('잘못된 프로세스 ID 입니다.'); return; }
    (async () => {
      setLoading(true);
      try {
        const data = await apiJson<ProcInst>(`/api/processes/${encodeURIComponent(id)}`);
        setInst(data || null);
        setError('');
        try { const tl = await apiJson<{ tasks: TimelineItem[] }>(`/api/processes/${encodeURIComponent(id)}/timeline`); setTimeline(tl?.tasks || []); } catch {}
        if (userId) {
          try {
            const mine = await apiJson<UserMe>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
            setMe(mine);
          } catch {}
        }
      } catch (e: any) {
        setError(e?.message || '프로세스 정보를 불러오지 못했습니다.');
        setInst(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Defensive: if detail fails to load, guide user back to list
  useEffect(() => {
    if (error) {
      try { alert(error); } catch {}
      const params = new URLSearchParams(loc.search || '');
      const ret = (params.get('return') || '').trim();
      if (ret && ret.startsWith('/')) nav(ret);
      else nav('/process/my');
    }
  }, [error]);

  const fmt = (s?: string) => (s ? new Date(s).toLocaleString() : '');

  const grouped = useMemo(() => {
    const map = new Map<string, ProcTask[]>();
    for (const t of inst?.tasks || []) {
      const key = t.stageLabel || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [inst]);

  const summary = useMemo(() => {
    const tasks = inst?.tasks || [];
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'COMPLETED').length;
    const inProgress = tasks.filter((t) => t.status === 'IN_PROGRESS').length;
    const ready = tasks.filter((t) => t.status === 'READY').length;
    const notStarted = tasks.filter((t) => t.status === 'NOT_STARTED').length;
    const skipped = tasks.filter((t) => t.status === 'SKIPPED').length;
    const now = Date.now();
    const overdue = tasks.filter((t: any) => t.plannedEndAt && t.status !== 'COMPLETED' && t.status !== 'SKIPPED' && new Date(t.plannedEndAt).getTime() < now).length;
    const pct = total ? Math.round((completed / total) * 100) : 100;
    return { total, completed, inProgress, ready, notStarted, skipped, overdue, pct };
  }, [inst]);

  if (loading && !inst) return <div>불러오는 중...</div>;
  if (error) return <div style={{ color: '#dc2626' }}>{error}</div>;
  if (!inst) return <div>존재하지 않는 프로세스입니다.</div>;

  async function reload() {
    if (!id) return;
    try {
      const data = await apiJson<ProcInst>(`/api/processes/${encodeURIComponent(id)}`);
      setInst(data || null);
      setError('');
    } catch (e: any) {
      setError(e?.message || '프로세스 정보를 불러오지 못했습니다.');
      setInst(null);
    }
    try { const hist = await apiJson<ModEntry[]>(`/api/processes/${encodeURIComponent(id)}/modifications`); setModHistory(hist || []); } catch {}
    try { const tl = await apiJson<{ tasks: TimelineItem[] }>(`/api/processes/${encodeURIComponent(id)}/timeline`); setTimeline(tl?.tasks || []); } catch {}
  }

  const onExecute = async (t: ProcTask) => {
    if (!id) return;
    const initiativeParam = inst?.initiativeId ? `&initiativeId=${encodeURIComponent(inst.initiativeId)}` : '';
    const q = `?processInstanceId=${encodeURIComponent(id)}&taskInstanceId=${encodeURIComponent(t.id)}${initiativeParam}`;
    if (t.taskType === 'WORKLOG') {
      try { await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/start`, { method: 'POST' }); } catch {}
      nav(`/worklogs/new${q}`);
      return;
    }
    if (t.taskType === 'COOPERATION') {
      try { await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/start`, { method: 'POST' }); } catch {}
      nav(`/coops/request${q}`);
      return;
    }
    if (t.taskType === 'APPROVAL') {
      try { await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/start`, { method: 'POST' }); } catch {}
      nav(`/approvals/new${q}`);
      return;
    }
    // TASK: 바로 완료 처리
    try {
      await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/complete`, { method: 'POST' });
      await reload();
    } catch {
      // ignore
    }
  };

  const canExec = () => {
    const role = String(me?.role || '').toUpperCase();
    return role === 'CEO' || role === 'EXEC';
  };

  const notStarted = useMemo(() => (inst?.tasks || []).filter((t) => t.status === 'NOT_STARTED'), [inst]);

  function toLocalInput(iso?: string) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  const onOpenModify = () => {
    const init: Record<string, any> = {};
    for (const t of notStarted) {
      init[t.id] = {
        skip: false,
        assigneeId: undefined,
        assigneeName: undefined,
        stageLabel: t.stageLabel || null,
        deadlineAt: toLocalInput(t.deadlineAt),
        plannedStartAt: toLocalInput(t.plannedStartAt),
        plannedEndAt: toLocalInput(t.plannedEndAt),
      };
    }
    setModRows(init);
    setModifyReason('');
    setShowModify(true);
  };

  const onApplyModify = async () => {
    if (!inst || !me) return;
    if (!modifyReason.trim()) { alert('사유를 입력하세요'); return; }
    const skipTaskIds = Object.entries(modRows).filter(([, v]) => v.skip).map(([k]) => k);
    const reassign = Object.entries(modRows)
      .filter(([k, v]) => {
        const orig = notStarted.find((t) => t.id === k);
        return !!v.assigneeId && v.assigneeId !== orig?.assigneeId;
      })
      .map(([k, v]) => ({ taskId: k, assigneeId: v.assigneeId! }));
    const update = Object.entries(modRows)
      .map(([k, v]) => {
        const orig = notStarted.find((t) => t.id === k);
        const patch: any = { taskId: k };
        let changed = false;
        if ((v.stageLabel || null) !== (orig?.stageLabel || null)) { patch.stageLabel = v.stageLabel || null; changed = true; }
        if ((v.deadlineAt || '') !== toLocalInput(orig?.deadlineAt)) { patch.deadlineAt = v.deadlineAt || null; changed = true; }
        if ((v.plannedStartAt || '') !== toLocalInput(orig?.plannedStartAt)) { patch.plannedStartAt = v.plannedStartAt || null; changed = true; }
        if ((v.plannedEndAt || '') !== toLocalInput(orig?.plannedEndAt)) { patch.plannedEndAt = v.plannedEndAt || null; changed = true; }
        return changed ? patch : null;
      })
      .filter(Boolean);
    if (!skipTaskIds.length && !(reassign as any[]).length && !(update as any[]).length) { alert('변경 사항이 없습니다'); return; }
    await apiJson(`/api/processes/${encodeURIComponent(inst.id)}/modify`, {
      method: 'POST',
      body: JSON.stringify({ actorId: me.id, reason: modifyReason, skipTaskIds, reassign, update }),
    });
    setShowModify(false);
    await reload();
  };

  const onStop = async () => {
    if (!inst || !me) return;
    const reason = window.prompt('중단 사유를 입력하세요 (필수)');
    if (!reason) return;
    const abort = window.confirm('완전 중단(ABORTED)?\n확인: ABORTED (재개 불가) / 취소: SUSPENDED (일시 중단)');
    const stopType = abort ? 'ABORTED' : 'SUSPENDED';
    await apiJson(`/api/processes/${encodeURIComponent(inst.id)}/stop`, { method: 'POST', body: JSON.stringify({ actorId: me.id, stopType, reason }) });
    await reload();
  };

  const onResume = async () => {
    if (!inst || !me) return;
    const reason = window.prompt('재개 사유를 입력하세요 (선택)') || '';
    await apiJson(`/api/processes/${encodeURIComponent(inst.id)}/resume`, { method: 'POST', body: JSON.stringify({ actorId: me.id, reason }) });
    await reload();
  };

  const onForceComplete = async (t: ProcTask) => {
    if (!inst || !me) return;
    const reason = window.prompt('강제 완료 사유를 입력하세요 (선택)') || '';
    await apiJson(`/api/processes/${encodeURIComponent(inst.id)}/tasks/${encodeURIComponent(t.id)}/force-complete`, { method: 'POST', body: JSON.stringify({ actorId: me.id, reason }) });
    await reload();
  };

  const onRollback = async (t: ProcTask) => {
    if (!inst || !me) return;
    const reason = window.prompt('되돌리기 사유를 입력하세요 (선택)') || '';
    await apiJson(`/api/processes/${encodeURIComponent(inst.id)}/tasks/${encodeURIComponent(t.id)}/rollback`, { method: 'POST', body: JSON.stringify({ actorId: me.id, reason }) });
    await reload();
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>프로세스 상세</h2>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 800 }}>{inst.title}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{inst.template?.title || ''}</div>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{inst.status}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {inst.status === 'ACTIVE' && canExec() && (
              <button className="btn btn-warning" onClick={onStop}>중단</button>
            )}
            {inst.status === 'SUSPENDED' && canExec() && (
              <button className="btn btn-primary" onClick={onResume}>재개</button>
            )}
            {canExec() && (
              <button className="btn" onClick={onOpenModify}>구조 수정</button>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          시작: {fmt(inst.startAt)}{inst.expectedEndAt ? ` · 예상완료: ${fmt(inst.expectedEndAt)}` : ''}{inst.endAt ? ` · 완료: ${fmt(inst.endAt)}` : ''}
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ background: '#DCFCE7', color: '#166534', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>완료 {summary.completed}/{summary.total}</span>
            {summary.inProgress ? <span style={{ background: '#DBEAFE', color: '#1E3A8A', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>진행 {summary.inProgress}</span> : null}
            {summary.ready ? <span style={{ background: '#F1F5F9', color: '#334155', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>대기 {summary.ready}</span> : null}
            {summary.overdue ? <span style={{ background: '#FEE2E2', color: '#991B1B', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>지연 {summary.overdue}</span> : null}
          </div>
          <div style={{ width: '100%', height: 10, background: '#EEF2F7', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${summary.pct}%`, height: '100%', background: '#22C55E' }} />
          </div>
        </div>
        {(inst.itemCode || inst.moldCode || inst.carModelCode) && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {[inst.itemCode && `품번:${inst.itemCode}`, inst.moldCode && `금형:${inst.moldCode}`, inst.carModelCode && `차종:${inst.carModelCode}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {grouped.map(([stage, tasks]) => (
          <div key={stage || '(no-stage)'} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{stage || '단계 미지정'}</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {tasks.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eef2f7', borderRadius: 6, padding: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{t.taskType} · {t.status}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {t.status === 'READY' && (
                      <button className="btn btn-primary" onClick={() => onExecute(t)}>실행</button>
                    )}
                    {canExec() && t.status !== 'COMPLETED' && (
                      <button className="btn" onClick={() => onForceComplete(t)}>강제완료</button>
                    )}
                    {canExec() && t.status !== 'NOT_STARTED' && (
                      <button className="btn btn-outline" onClick={() => onRollback(t)}>되돌리기</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!grouped.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>과제가 없습니다.</div>}
      </div>

      {showModify && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 16, width: 'min(900px, 96vw)', maxHeight: '90vh', overflow: 'auto', display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ fontWeight: 800 }}>실행 전 단계 구조 수정</div>
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setShowModify(false)}>닫기</button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, color: '#64748b' }}>사유</span>
                <input value={modifyReason} onChange={(e) => setModifyReason(e.target.value)} placeholder="변경 사유를 입력하세요" style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }} />
              </label>
              <div style={{ fontSize: 12, color: '#64748b' }}>대상: NOT_STARTED 과제만 변경/스킵/배정 변경 가능</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {notStarted.map((t) => {
                  const row = modRows[t.id] || {};
                  return (
                    <div key={t.id} style={{ display: 'grid', gap: 6, border: '1px solid #E5E7EB', borderRadius: 8, padding: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={!!row.skip} onChange={(e) => setModRows((m) => ({ ...m, [t.id]: { ...m[t.id], skip: e.target.checked } }))} />
                        <div style={{ fontWeight: 700 }}>{t.name}</div>
                        <div style={{ color: '#64748b', fontSize: 12 }}>({t.taskType})</div>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                          <button className="btn" onClick={() => setUserPickForTask(t.id)}>담당자 변경</button>
                          <div style={{ fontSize: 12, color: '#64748b' }}>{row.assigneeName || row.assigneeId || t.assigneeId || ''}</div>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 6, gridTemplateColumns: '1fr 1fr 1fr 1fr', alignItems: 'end' }}>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span style={{ fontSize: 12, color: '#64748b' }}>단계 라벨</span>
                          <input value={row.stageLabel ?? ''} onChange={(e) => setModRows((m) => ({ ...m, [t.id]: { ...m[t.id], stageLabel: e.target.value || null } }))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span style={{ fontSize: 12, color: '#64748b' }}>마감일</span>
                          <input type="datetime-local" value={row.deadlineAt || ''} onChange={(e) => setModRows((m) => ({ ...m, [t.id]: { ...m[t.id], deadlineAt: e.target.value } }))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span style={{ fontSize: 12, color: '#64748b' }}>예정 시작</span>
                          <input type="datetime-local" value={row.plannedStartAt || ''} onChange={(e) => setModRows((m) => ({ ...m, [t.id]: { ...m[t.id], plannedStartAt: e.target.value } }))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }} />
                        </label>
                        <label style={{ display: 'grid', gap: 4 }}>
                          <span style={{ fontSize: 12, color: '#64748b' }}>예정 종료</span>
                          <input type="datetime-local" value={row.plannedEndAt || ''} onChange={(e) => setModRows((m) => ({ ...m, [t.id]: { ...m[t.id], plannedEndAt: e.target.value } }))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }} />
                        </label>
                      </div>
                    </div>
                  );
                })}
                {!notStarted.length && <div style={{ color: '#94a3b8' }}>변경 가능한 과제가 없습니다.</div>}
              </div>
              {/* preview */}
              <div style={{ borderTop: '1px dashed #E5E7EB', marginTop: 8, paddingTop: 8 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>변경 미리보기</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {(() => {
                    const skips = Object.entries(modRows).filter(([, v]) => v.skip).map(([k]) => k);
                    const reassigns = Object.entries(modRows)
                      .filter(([k, v]) => v.assigneeId && v.assigneeId !== notStarted.find((t) => t.id === k)?.assigneeId)
                      .map(([k, v]) => ({ id: k, name: inst?.tasks.find((t) => t.id === k)?.name || k, assignee: v.assigneeName || v.assigneeId }));
                    const updates = Object.entries(modRows).map(([k, v]) => {
                      const orig = notStarted.find((t) => t.id === k);
                      const diffs: string[] = [];
                      if ((v.stageLabel || null) !== (orig?.stageLabel || null)) diffs.push(`단계라벨: ${(orig?.stageLabel||'') || '(없음)'} → ${(v.stageLabel||'') || '(없음)'}`);
                      const toLocal = (x?: string) => x ? toLocalInput(x) : '';
                      if ((v.deadlineAt || '') !== toLocal(orig?.deadlineAt)) diffs.push(`마감: ${(toLocal(orig?.deadlineAt)||'(없음)')} → ${(v.deadlineAt||'(없음)')}`);
                      if ((v.plannedStartAt || '') !== toLocal(orig?.plannedStartAt)) diffs.push(`예정시작: ${(toLocal(orig?.plannedStartAt)||'(없음)')} → ${(v.plannedStartAt||'(없음)')}`);
                      if ((v.plannedEndAt || '') !== toLocal(orig?.plannedEndAt)) diffs.push(`예정종료: ${(toLocal(orig?.plannedEndAt)||'(없음)')} → ${(v.plannedEndAt||'(없음)')}`);
                      return diffs.length ? { id: k, name: inst?.tasks.find((t) => t.id === k)?.name || k, diffs } : null;
                    }).filter(Boolean) as { id: string; name: string; diffs: string[] }[];
                    return (
                      <div style={{ display: 'grid', gap: 6 }}>
                        <div>스킵 {skips.length}건{skips.length ? ': ' + skips.map((id) => inst?.tasks.find((t)=>t.id===id)?.name || id).join(', ') : ''}</div>
                        <div>재배정 {reassigns.length}건{reassigns.length ? ': ' + reassigns.map((r) => `${r.name} → ${r.assignee}`).join(', ') : ''}</div>
                        <div>
                          업데이트 {updates.length}건
                          <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                            {updates.map((u) => (
                              <div key={u.id} style={{ fontSize: 12, color: '#64748b' }}>{u.name}: {u.diffs.join(' · ')}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowModify(false)}>취소</button>
              <button className="btn btn-primary" onClick={onApplyModify} disabled={!notStarted.length}>적용</button>
            </div>
          </div>
          {userPickForTask && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
              <UserPicker
                onSelect={(u: PickedUser) => {
                  const tid = userPickForTask;
                  setModRows((m) => ({ ...m, [tid]: { ...m[tid], assigneeId: u.id, assigneeName: u.name } }));
                  setUserPickForTask(null);
                }}
                onClose={() => setUserPickForTask(null)}
              />
            </div>
          )}
        </div>
      )}

      {/* modification history */}
      {canExec() && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ fontWeight: 800 }}>구조 변경 이력</div>
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={reload}>새로고침</button>
          </div>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {modHistory.map((h, idx) => (
              <div key={idx} style={{ border: '1px solid #EEF2F7', borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(h.ts).toLocaleString()} · by {h.userId}</div>
                <div style={{ marginTop: 4 }}>{h.reason}</div>
                {h.changes?.length ? (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                    {h.changes.map((c, i) => (
                      <div key={i}>{c.type.toUpperCase()}: {c.name || c.taskId}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            {!modHistory.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>이력이 없습니다.</div>}
          </div>
        </div>
      )}

      {/* timeline (세부 내용) */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontWeight: 800 }}>세부 내용</div>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={reload}>새로고침</button>
        </div>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {timeline.map((it) => (
            <div key={it.id} style={{ border: '1px solid #EEF2F7', borderRadius: 8, padding: 8, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>{it.name}{it.stageLabel ? ` · ${it.stageLabel}` : ''}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{it.taskType} · {it.status}</div>
              </div>
              {it.worklog && (
                <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>업무일지: {it.worklog.title}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{it.worklog.createdAt ? new Date(it.worklog.createdAt).toLocaleString() : ''}{it.worklog.createdBy ? ` · ${it.worklog.createdBy.name}` : ''}</div>
                  {(it.worklog.contentHtml || it.worklog.note) ? (
                    <div style={{ marginTop: 6 }}>
                      <WorklogDocument worklog={it.worklog} variant="content" />
                    </div>
                  ) : null}
                </div>
              )}
              {it.cooperation && (
                <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>업무 요청: {it.cooperation.category || '-'}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{it.cooperation.status || ''}{it.cooperation.assignee ? ` · 담당: ${it.cooperation.assignee.name}` : ''}{it.cooperation.dueAt ? ` · 기한: ${new Date(it.cooperation.dueAt).toLocaleString()}` : ''}</div>
                  {(it.cooperation.worklog?.contentHtml || it.cooperation.worklog?.note) ? (
                    <div style={{ marginTop: 6 }}>
                      <WorklogDocument worklog={it.cooperation.worklog} variant="content" />
                    </div>
                  ) : null}
                </div>
              )}
              {it.approval && (
                <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>결재: {it.approval.status || '-'}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{it.approval.requestedBy ? `요청자: ${it.approval.requestedBy.name}` : ''}{it.approval.dueAt ? ` · 기한: ${new Date(it.approval.dueAt).toLocaleString()}` : ''}</div>
                  {(it.approval.steps || []).length ? (
                    <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                      {(it.approval.steps || []).map((s, idx) => (
                        <div key={idx} style={{ fontSize: 12, color: '#334155' }}>#{s.stepNo} {s.approverId} · {s.status}{s.actedAt ? ` · ${new Date(s.actedAt).toLocaleString()}` : ''}{s.comment ? ` · ${s.comment}` : ''}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ))}
          {!timeline.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>진행된 세부 내역이 없습니다.</div>}
        </div>
      </div>
    </div>
  );
}
