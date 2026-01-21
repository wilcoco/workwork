import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime, formatMinutesAsHmKo } from '../lib/time';

type DailyItem = {
  id: string;
  createdAt: string;
  date: string;
  timeSpentMinutes: number;
  title: string;
  excerpt: string;
  createdById: string;
  userName: string;
  orgUnitId: string;
  teamName: string;
  urgent?: boolean;
};

type DailyGroup = {
  ymd: string;
  count: number;
  minutes: number;
  items: DailyItem[];
};

type DailyStats = {
  from: string;
  to: string;
  days: number;
  totalCount: number;
  totalMinutes: number;
  groups: DailyGroup[];
};

type Me = {
  id: string;
  name: string;
  role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL';
  orgUnitId: string;
  teamName: string;
};

type OrgUnitItem = { id: string; name: string };

type UserItem = {
  id: string;
  name: string;
  orgUnitId: string;
  orgName: string;
};

type EvalStatus = 'BLUE' | 'GREEN' | 'YELLOW' | 'RED';

type TeamDailyEvalItem = {
  id: string;
  ymd: string;
  orgUnitId: string;
  orgUnitName: string;
  evaluatorId: string;
  status: EvalStatus;
  createdAt: string;
  updatedAt: string;
};

export function WorklogStatsDaily() {
  const myUserId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  const [me, setMe] = useState<Me | null>(null);
  const [teams, setTeams] = useState<OrgUnitItem[]>([]);
  const [managedTeams, setManagedTeams] = useState<OrgUnitItem[]>([]);

  const [days, setDays] = useState(7);
  const [teamId, setTeamId] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<UserItem[]>([]);

  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DailyStats | null>(null);

  const [isMobile, setIsMobile] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedWorklogId, setSelectedWorklogId] = useState<string | null>(null);

  const [evalOpen, setEvalOpen] = useState(false);
  const [evalYmd, setEvalYmd] = useState<string>('');
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalTeamStatus, setEvalTeamStatus] = useState<Record<string, EvalStatus>>({});

  const scopeOrgUnitIds = useMemo(() => {
    const role = me?.role;
    const ids = new Set<string>();
    if (role === 'CEO') {
      (teams || []).forEach((t) => ids.add(String(t.id)));
    } else if (role === 'EXEC') {
      (managedTeams || []).forEach((t) => ids.add(String(t.id)));
    } else if (role === 'MANAGER') {
      if ((managedTeams || []).length > 0) {
        (managedTeams || []).forEach((t) => ids.add(String(t.id)));
      } else if (me?.orgUnitId) {
        ids.add(String(me.orgUnitId));
      }
    }
    return ids;
  }, [managedTeams, me?.orgUnitId, me?.role, teams]);

  const canSearch = useMemo(() => {
    if (teamId === '__managed__') return managedTeams.length > 0;
    return !!(String(teamId || '').trim() || String(userId || '').trim());
  }, [managedTeams.length, teamId, userId]);

  const canEvaluate = useMemo(() => {
    const role = me?.role;
    return role === 'CEO' || role === 'EXEC' || role === 'MANAGER';
  }, [me?.role]);

  const teamOptions = useMemo(() => {
    return [...(teams || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [teams]);

  const userOptions = useMemo(() => {
    return [...(users || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [users]);

  const evalTeamsForDay = useMemo(() => {
    if (!canEvaluate) return [] as Array<{ id: string; name: string; count: number; minutes: number }>;
    if (scopeOrgUnitIds.size === 0) return [];
    const g = (result?.groups || []).find((x) => x.ymd === evalYmd);
    if (!g) return [];
    const map = new Map<string, { id: string; name: string; count: number; minutes: number }>();
    for (const it of g.items || []) {
      const ou = String(it.orgUnitId || '');
      if (!ou) continue;
      if (!scopeOrgUnitIds.has(ou)) continue;
      if (!map.has(ou)) {
        map.set(ou, { id: ou, name: String(it.teamName || ''), count: 0, minutes: 0 });
      }
      const cur = map.get(ou)!;
      cur.count += 1;
      cur.minutes += Number(it.timeSpentMinutes || 0);
    }
    return Array.from(map.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [canEvaluate, evalYmd, result?.groups, scopeOrgUnitIds]);

  const canEvalGroup = (g: DailyGroup) => {
    if (!canEvaluate) return false;
    if (scopeOrgUnitIds.size === 0) return false;
    const seen = new Set<string>();
    for (const it of g.items || []) {
      const ou = String(it.orgUnitId || '');
      if (!ou) continue;
      if (!scopeOrgUnitIds.has(ou)) continue;
      seen.add(ou);
    }
    return seen.size > 0;
  };

  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth < 768);
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', update);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', update);
      }
    };
  }, []);

  useEffect(() => {
    (async () => {
      if (!myUserId) return;
      try {
        const m = await apiJson<Me>(`/api/users/me?userId=${encodeURIComponent(myUserId)}`);
        setMe(m);
      } catch {
        setMe(null);
      }
    })();
  }, [myUserId]);

  useEffect(() => {
    (async () => {
      try {
        const r = await apiJson<{ items: OrgUnitItem[] }>(`/api/orgs`);
        setTeams(Array.isArray(r?.items) ? r.items : []);
      } catch {
        setTeams([]);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!myUserId) return;
      try {
        const r = await apiJson<{ items: OrgUnitItem[] }>(`/api/orgs/managed?userId=${encodeURIComponent(myUserId)}`);
        setManagedTeams(Array.isArray(r?.items) ? r.items : []);
      } catch {
        setManagedTeams([]);
      }
    })();
  }, [myUserId]);

  useEffect(() => {
    (async () => {
      if (!teamId || teamId === '__managed__') {
        setUsers([]);
        setUserId('');
        return;
      }
      try {
        const r = await apiJson<{ items: UserItem[] }>(`/api/users?orgUnitId=${encodeURIComponent(teamId)}`);
        setUsers(Array.isArray(r?.items) ? r.items : []);
      } catch {
        setUsers([]);
      }
    })();
  }, [teamId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof document === 'undefined') return;
    if (!detailOpen && !evalOpen) return;

    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollBarWidth > 0) body.style.paddingRight = `${scrollBarWidth}px`;

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [detailOpen, evalOpen]);

  async function openEval(ymd: string) {
    if (!canEvaluate) return;
    if (!myUserId) return;
    setEvalOpen(true);
    setEvalYmd(ymd);
    setEvalError(null);

    setEvalTeamStatus({});

    if (scopeOrgUnitIds.size === 0) {
      setEvalError('평가 권한이 없습니다.');
      return;
    }

    const g = (result?.groups || []).find((x) => x.ymd === ymd);
    const ids = Array.from(
      new Set(
        (g?.items || [])
          .map((it) => String(it.orgUnitId || ''))
          .filter(Boolean)
          .filter((id) => scopeOrgUnitIds.has(String(id)))
      )
    );
    if (ids.length === 0) {
      setEvalError('평가할 팀이 없습니다.');
      return;
    }

    setEvalLoading(true);
    try {
      const r = await apiJson<{ items: TeamDailyEvalItem[] }>(
        `/api/worklog-evals/team-daily?userId=${encodeURIComponent(myUserId)}&ymd=${encodeURIComponent(ymd)}&orgUnitIds=${encodeURIComponent(ids.join(','))}`
      );
      const map: Record<string, EvalStatus> = {};
      for (const it of r?.items || []) {
        map[String(it.orgUnitId)] = String(it.status) as EvalStatus;
      }
      setEvalTeamStatus(map);
    } catch (e: any) {
      setEvalError(e?.message || '평가 조회 실패');
    } finally {
      setEvalLoading(false);
    }
  }

  function closeEval() {
    setEvalOpen(false);
    setEvalYmd('');
    setEvalLoading(false);
    setEvalError(null);
    setEvalTeamStatus({});
  }

  async function setTeamStatus(orgUnitId: string, status: EvalStatus) {
    if (!myUserId) return;
    if (!evalYmd) return;
    setEvalLoading(true);
    setEvalError(null);
    try {
      const payload = { ymd: evalYmd, orgUnitId, status };
      await apiJson(`/api/worklog-evals/team-daily?userId=${encodeURIComponent(myUserId)}`, { method: 'POST', body: JSON.stringify(payload) });
      setEvalTeamStatus((prev) => ({ ...prev, [String(orgUnitId)]: status }));
    } catch (e: any) {
      setEvalError(e?.message || '평가 저장 실패');
    } finally {
      setEvalLoading(false);
    }
  }

  async function onSearch() {
    if (!myUserId) return;
    if (!canSearch) return;

    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const qs = new URLSearchParams({ days: String(days), viewerId: myUserId });
      if (teamId === '__managed__') {
        const ids = (managedTeams || []).map((t) => String(t.id)).filter(Boolean);
        if (ids.length) qs.set('orgUnitIds', ids.join(','));
      } else {
        if (teamId) qs.set('teamId', teamId);
      }
      if (userId) qs.set('userId', userId);
      const r = await apiJson<DailyStats>(`/api/worklogs/stats/daily?${qs.toString()}`);
      setResult(r);
    } catch (e: any) {
      setError(e?.message || '조회 실패');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(220px, 1fr) minmax(220px, 1fr) minmax(220px, 1fr) auto',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <select
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
          }}
          style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}
        >
          <option value="">팀 선택</option>
          {managedTeams.length > 0 && <option value="__managed__">내 주관팀 전체</option>}
          {teamOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}
          disabled={!teamId || teamId === '__managed__'}
        >
          <option value="">구성원 선택</option>
          {userOptions.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>

        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}>
          <option value={7}>최근 7일</option>
          <option value={14}>최근 14일</option>
          <option value={30}>최근 30일</option>
        </select>

        <button className="btn" onClick={onSearch} disabled={!canSearch || loading}>
          {loading ? '검색…' : '검색'}
        </button>
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}

      {!searched && <div style={{ color: '#64748b' }}>팀 또는 구성원을 선택한 뒤 검색을 눌러주세요.</div>}

      {searched && !loading && !result && !error && <div style={{ color: '#64748b' }}>데이터가 없습니다.</div>}

      {result && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            기간: {formatKstDatetime(result.from)} ~ {formatKstDatetime(result.to)} · {result.totalCount}건 · {formatMinutesAsHmKo(result.totalMinutes)}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {(result.groups || []).map((g) => (
              <div key={g.ymd} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 900, color: '#0f172a' }}>{g.ymd}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>· {g.count}건 · {formatMinutesAsHmKo(g.minutes)}</div>
                  {canEvaluate ? (
                    <button
                      type="button"
                      className="btn"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => openEval(g.ymd)}
                      disabled={!canEvalGroup(g)}
                    >
                      팀 일 단위 평가
                    </button>
                  ) : null}
                </div>
                <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                  {(g.items || []).map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      style={{ textAlign: 'left', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff', cursor: 'pointer', display: 'grid', gap: 4 }}
                      onClick={() => {
                        setSelectedWorklogId(it.id);
                        setDetailOpen(true);
                      }}
                    >
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{it.title || '(제목 없음)'}</div>
                      <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700, color: '#334155' }}>{it.userName}</div>
                        <div>·</div>
                        <div>{formatKstDatetime(it.createdAt)}</div>
                        <div style={{ marginLeft: 'auto' }}>{formatMinutesAsHmKo(it.timeSpentMinutes)}</div>
                      </div>
                    </button>
                  ))}
                  {(g.items || []).length === 0 && <div style={{ color: '#94a3b8' }}>업무일지가 없습니다.</div>}
                </div>
              </div>
            ))}
            {(result.groups || []).length === 0 && <div style={{ color: '#94a3b8' }}>데이터가 없습니다.</div>}
          </div>
        </div>
      )}

      {detailOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16, boxSizing: 'border-box' }}
          onClick={() => { setDetailOpen(false); setSelectedWorklogId(null); }}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 0, width: 'min(1100px, 96vw)', height: 'min(85vh, 920px)', maxHeight: 'calc(100vh - 32px)', display: 'grid', gridTemplateRows: '44px 1fr', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontWeight: 800 }}>업무일지 상세</div>
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => { setDetailOpen(false); setSelectedWorklogId(null); }}>닫기</button>
            </div>
            <div style={{ overflow: 'hidden' }}>
              {selectedWorklogId ? (
                <iframe
                  title="worklog-detail"
                  src={`/worklogs/${encodeURIComponent(selectedWorklogId)}?embed=1`}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                />
              ) : (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>업무일지를 선택해 주세요.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {evalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16, boxSizing: 'border-box' }}
          onClick={closeEval}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 0, width: 'min(820px, 96vw)', height: 'min(80vh, 820px)', maxHeight: 'calc(100vh - 32px)', display: 'grid', gridTemplateRows: '44px 1fr', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontWeight: 800 }}>팀 일 단위 평가 · {evalYmd}</div>
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={closeEval}>닫기</button>
            </div>
            <div style={{ overflow: 'auto', padding: 12, display: 'grid', gap: 10 }}>
              {evalError && <div style={{ color: 'red' }}>{evalError}</div>}

              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>팀별 상태 선택</div>
                {(evalTeamsForDay || []).map((t) => {
                  const cur = evalTeamStatus[String(t.id)];
                  const btnStyle = (bg: string, active: boolean) => ({
                    border: active ? '2px solid #0f172a' : '1px solid #e5e7eb',
                    borderRadius: 10,
                    padding: '8px 10px',
                    background: bg,
                    color: '#0f172a',
                    fontWeight: active ? 900 : 700,
                    cursor: evalLoading ? 'not-allowed' : 'pointer',
                    opacity: evalLoading ? 0.7 : 1,
                  } as const);
                  return (
                    <div key={t.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, background: '#fff', display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>{t.name || t.id}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>· {t.count}건 · {formatMinutesAsHmKo(t.minutes)}</div>
                        {cur ? <div style={{ marginLeft: 'auto', fontSize: 12, color: '#0f172a', fontWeight: 800 }}>{cur}</div> : <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>미평가</div>}
                      </div>
                      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)' }}>
                        <button type="button" onClick={() => setTeamStatus(String(t.id), 'BLUE')} disabled={evalLoading} style={btnStyle('#93c5fd', cur === 'BLUE')}>파랑(우수)</button>
                        <button type="button" onClick={() => setTeamStatus(String(t.id), 'GREEN')} disabled={evalLoading} style={btnStyle('#86efac', cur === 'GREEN')}>초록(정상)</button>
                        <button type="button" onClick={() => setTeamStatus(String(t.id), 'YELLOW')} disabled={evalLoading} style={btnStyle('#fde68a', cur === 'YELLOW')}>노랑(주의)</button>
                        <button type="button" onClick={() => setTeamStatus(String(t.id), 'RED')} disabled={evalLoading} style={btnStyle('#fca5a5', cur === 'RED')}>빨강(지원)</button>
                      </div>
                    </div>
                  );
                })}
                {(evalTeamsForDay || []).length === 0 && <div style={{ color: '#94a3b8' }}>평가할 팀이 없습니다.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

