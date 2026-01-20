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

type FeedbackItem = {
  id: string;
  subjectType: string;
  subjectId: string;
  authorId: string;
  authorName?: string;
  content: string;
  rating?: number | null;
  actionRequired?: boolean;
  createdAt: string;
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
  const [evalTargetUserId, setEvalTargetUserId] = useState<string>('');
  const [evalTargetUserName, setEvalTargetUserName] = useState<string>('');
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalItems, setEvalItems] = useState<FeedbackItem[]>([]);
  const [evalText, setEvalText] = useState('');
  const [evalRating, setEvalRating] = useState<string>('');

  const scopeOrgUnitIds = useMemo(() => {
    const role = me?.role;
    const ids = new Set<string>();
    if (role === 'MANAGER') {
      if ((managedTeams || []).length > 0) {
        (managedTeams || []).forEach((t) => ids.add(String(t.id)));
      } else if (me?.orgUnitId) {
        ids.add(String(me.orgUnitId));
      }
    } else if (role === 'EXEC' || role === 'CEO') {
      (managedTeams || []).forEach((t) => ids.add(String(t.id)));
    }
    return ids;
  }, [managedTeams, me?.orgUnitId, me?.role]);

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

  const evalTargetsForDay = useMemo(() => {
    if (!canEvaluate) return [] as Array<{ id: string; name: string }>;
    if (scopeOrgUnitIds.size === 0) return [];
    const g = (result?.groups || []).find((x) => x.ymd === evalYmd);
    if (!g) return [];
    const map = new Map<string, string>();
    for (const it of g.items || []) {
      if (!it.createdById) continue;
      if (String(it.createdById) === String(myUserId)) continue;
      const ou = String(it.orgUnitId || '');
      if (ou && !scopeOrgUnitIds.has(ou)) continue;
      map.set(String(it.createdById), String(it.userName || ''));
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [canEvaluate, evalYmd, myUserId, result?.groups, scopeOrgUnitIds]);

  const canEvalGroup = (g: DailyGroup) => {
    if (!canEvaluate) return false;
    if (scopeOrgUnitIds.size === 0) return false;
    const seen = new Set<string>();
    for (const it of g.items || []) {
      if (!it.createdById) continue;
      if (String(it.createdById) === String(myUserId)) continue;
      const ou = String(it.orgUnitId || '');
      if (ou && !scopeOrgUnitIds.has(ou)) continue;
      seen.add(String(it.createdById));
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

  async function loadFeedbacks(targetUserId: string, ymd: string) {
    if (!targetUserId || !ymd) return;
    setEvalLoading(true);
    setEvalError(null);
    try {
      const subjectType = 'WorklogDay';
      const subjectId = `${targetUserId}|${ymd}`;
      const r = await apiJson<{ items: FeedbackItem[] }>(`/api/feedbacks?subjectType=${encodeURIComponent(subjectType)}&subjectId=${encodeURIComponent(subjectId)}&limit=50`);
      setEvalItems(Array.isArray(r?.items) ? r.items : []);
    } catch (e: any) {
      setEvalError(e?.message || '평가 조회 실패');
      setEvalItems([]);
    } finally {
      setEvalLoading(false);
    }
  }

  async function openEval(ymd: string) {
    if (!canEvaluate) return;
    setEvalOpen(true);
    setEvalYmd(ymd);
    setEvalError(null);
    setEvalItems([]);
    setEvalText('');
    setEvalRating('');

    const g = (result?.groups || []).find((x) => x.ymd === ymd);
    const map = new Map<string, string>();
    for (const it of g?.items || []) {
      if (!it.createdById) continue;
      if (String(it.createdById) === String(myUserId)) continue;
      const ou = String(it.orgUnitId || '');
      if (scopeOrgUnitIds.size === 0) continue;
      if (ou && !scopeOrgUnitIds.has(ou)) continue;
      map.set(String(it.createdById), String(it.userName || ''));
    }
    const targets = Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

    if (targets.length === 1) {
      setEvalTargetUserId(targets[0].id);
      setEvalTargetUserName(targets[0].name);
      await loadFeedbacks(targets[0].id, ymd);
    } else {
      setEvalTargetUserId('');
      setEvalTargetUserName('');
      if (targets.length === 0) {
        setEvalError('평가할 대상이 없습니다.');
      }
    }
  }

  function closeEval() {
    setEvalOpen(false);
    setEvalYmd('');
    setEvalTargetUserId('');
    setEvalTargetUserName('');
    setEvalLoading(false);
    setEvalError(null);
    setEvalItems([]);
    setEvalText('');
    setEvalRating('');
  }

  async function submitEval() {
    if (!myUserId) return;
    if (!evalTargetUserId || !evalYmd) return;
    const content = String(evalText || '').trim();
    if (!content) return;
    setEvalLoading(true);
    setEvalError(null);
    try {
      const ratingNum = parseInt(String(evalRating || ''), 10);
      const payload: any = {
        subjectType: 'WorklogDay',
        subjectId: `${evalTargetUserId}|${evalYmd}`,
        authorId: myUserId,
        content,
        targetUserId: evalTargetUserId,
      };
      if (!isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 5) payload.rating = ratingNum;
      await apiJson(`/api/feedbacks`, { method: 'POST', body: JSON.stringify(payload) });
      setEvalText('');
      setEvalRating('');
      await loadFeedbacks(evalTargetUserId, evalYmd);
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
                      일 단위 평가
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
              <div style={{ fontWeight: 800 }}>일 단위 평가 · {evalYmd}</div>
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={closeEval}>닫기</button>
            </div>
            <div style={{ overflow: 'auto', padding: 12, display: 'grid', gap: 10 }}>
              {evalError && <div style={{ color: 'red' }}>{evalError}</div>}

              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>대상 구성원</div>
                <select
                  value={evalTargetUserId}
                  onChange={async (e) => {
                    const id = e.target.value;
                    setEvalTargetUserId(id);
                    const name = evalTargetsForDay.find((t) => t.id === id)?.name || '';
                    setEvalTargetUserName(name);
                    if (id) await loadFeedbacks(id, evalYmd);
                    else setEvalItems([]);
                  }}
                  style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}
                >
                  <option value="">선택</option>
                  {evalTargetsForDay.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>평가 입력{evalTargetUserName ? ` (${evalTargetUserName})` : ''}</div>
                <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : '120px 1fr auto', alignItems: 'center' }}>
                  <select
                    value={evalRating}
                    onChange={(e) => setEvalRating(e.target.value)}
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}
                    disabled={!evalTargetUserId || evalLoading}
                  >
                    <option value="">평점(선택)</option>
                    <option value="5">5</option>
                    <option value="4">4</option>
                    <option value="3">3</option>
                    <option value="2">2</option>
                    <option value="1">1</option>
                  </select>
                  <input
                    value={evalText}
                    onChange={(e) => setEvalText(e.target.value)}
                    placeholder="코멘트를 입력하세요"
                    style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px', width: '100%' }}
                    disabled={!evalTargetUserId || evalLoading}
                  />
                  <button className="btn" onClick={submitEval} disabled={!evalTargetUserId || evalLoading || !String(evalText || '').trim()}>
                    {evalLoading ? '저장…' : '저장'}
                  </button>
                </div>
              </div>

              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10, display: 'grid', gap: 8 }}>
                <div style={{ fontSize: 12, color: '#64748b' }}>기존 평가</div>
                {(evalItems || []).map((it) => (
                  <div key={it.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff', display: 'grid', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800, color: '#0f172a' }}>{it.authorName || ''}</div>
                      {typeof it.rating === 'number' ? <div style={{ fontSize: 12, color: '#0f172a', fontWeight: 700 }}>· {it.rating}점</div> : null}
                      <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{formatKstDatetime(it.createdAt)}</div>
                    </div>
                    <div style={{ color: '#334155', lineHeight: 1.45 }}>{it.content}</div>
                  </div>
                ))}
                {(evalItems || []).length === 0 && <div style={{ color: '#94a3b8' }}>평가가 없습니다.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

