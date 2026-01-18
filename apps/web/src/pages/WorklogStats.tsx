import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime, formatMinutesAsHmKo } from '../lib/time';

type DetailItem = {
  id: string;
  createdAt: string;
  date: string;
  timeSpentMinutes: number;
  title: string;
  excerpt: string;
  userName: string;
  teamName: string;
  taskName?: string;
  objectiveTitle?: string;
  keyResultTitle?: string;
  initiativeTitle?: string;
};

export function WorklogStats() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    from: string;
    to: string;
    days: number;
    total: number;
    teams: Array<{
      teamName: string;
      total: number;
      members: Array<{
        userName: string;
        count: number;
        minutes: number;
        recent?: Array<{ id: string; title: string; createdAt?: string; date?: string }>;
      }>;
    }>;
  } | null>(null);
  const [team, setTeam] = useState('');
  const [user, setUser] = useState('');
  const [isMobile, setIsMobile] = useState(false);

  const myUserId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailMoreLoading, setDetailMoreLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailCtx, setDetailCtx] = useState<{ teamName: string; userName: string } | null>(null);
  const [detail, setDetail] = useState<{
    from: string;
    to: string;
    days: number;
    totalCount: number;
    totalMinutes: number;
    items: DetailItem[];
    nextCursor?: string | null;
    hasMore?: boolean;
  } | null>(null);
  const [selectedWorklogId, setSelectedWorklogId] = useState<string | null>(null);

  const groupedDetail = useMemo(() => {
    if (!detail) {
      return [] as Array<{
        objectiveTitle: string;
        totalCount: number;
        totalMinutes: number;
        keyResults: Array<{ keyResultTitle: string; totalCount: number; totalMinutes: number; items: DetailItem[] }>;
      }>;
    }

    const objectiveMap = new Map<
      string,
      {
        totalCount: number;
        totalMinutes: number;
        keyResultMap: Map<string, { totalCount: number; totalMinutes: number; items: DetailItem[] }>;
      }
    >();

    for (const it of detail.items) {
      const objectiveTitle = it.objectiveTitle || '상위 과제 없음';
      const keyResultTitle = it.keyResultTitle || 'KR 없음';
      const minutes = Number(it.timeSpentMinutes) || 0;

      if (!objectiveMap.has(objectiveTitle)) {
        objectiveMap.set(objectiveTitle, { totalCount: 0, totalMinutes: 0, keyResultMap: new Map() });
      }
      const obj = objectiveMap.get(objectiveTitle)!;
      obj.totalCount += 1;
      obj.totalMinutes += minutes;

      if (!obj.keyResultMap.has(keyResultTitle)) {
        obj.keyResultMap.set(keyResultTitle, { totalCount: 0, totalMinutes: 0, items: [] });
      }
      const kr = obj.keyResultMap.get(keyResultTitle)!;
      kr.totalCount += 1;
      kr.totalMinutes += minutes;
      kr.items.push(it);
    }

    const objectives = Array.from(objectiveMap.entries()).map(([objectiveTitle, obj]) => {
      const keyResults = Array.from(obj.keyResultMap.entries())
        .map(([keyResultTitle, kr]) => {
          const items = [...kr.items].sort((a, b) => (String(b.createdAt).localeCompare(String(a.createdAt))));
          return { keyResultTitle, totalCount: kr.totalCount, totalMinutes: kr.totalMinutes, items };
        })
        .sort((a, b) => (b.totalMinutes - a.totalMinutes) || (b.totalCount - a.totalCount) || a.keyResultTitle.localeCompare(b.keyResultTitle));
      return { objectiveTitle, totalCount: obj.totalCount, totalMinutes: obj.totalMinutes, keyResults };
    });

    objectives.sort((a, b) => (b.totalMinutes - a.totalMinutes) || (b.totalCount - a.totalCount) || a.objectiveTitle.localeCompare(b.objectiveTitle));
    return objectives;
  }, [detail]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days: String(days) });
      if (team) qs.set('team', team);
      if (user) qs.set('user', user);
      if (myUserId) qs.set('viewerId', myUserId);
      const r = await apiJson(`/api/worklogs/stats/weekly?${qs.toString()}`);
      setData(r);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function openMember(teamName: string, userName: string) {
    setDetailOpen(true);
    setDetailCtx({ teamName, userName });
    setSelectedWorklogId(null);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const qs = new URLSearchParams({ days: String(days), team: teamName, user: userName, limit: '180' });
      if (myUserId) qs.set('viewerId', myUserId);
      const r = await apiJson(`/api/worklogs/stats/weekly/details?${qs.toString()}`);
      setDetail(r);
    } catch (e: any) {
      setDetailError(e?.message || '상세 로드 실패');
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadMoreDetail() {
    if (!detailCtx) return;
    if (!detail?.hasMore || !detail?.nextCursor) return;
    if (detailMoreLoading) return;
    setDetailMoreLoading(true);
    setDetailError(null);
    try {
      const qs = new URLSearchParams({
        days: String(days),
        team: detailCtx.teamName,
        user: detailCtx.userName,
        cursor: String(detail.nextCursor),
        limit: '240',
      });
      if (myUserId) qs.set('viewerId', myUserId);
      const r = await apiJson<any>(`/api/worklogs/stats/weekly/details?${qs.toString()}`);
      setDetail((prev) => {
        if (!prev) return r;
        return {
          ...prev,
          from: r.from ?? prev.from,
          to: r.to ?? prev.to,
          days: r.days ?? prev.days,
          totalCount: r.totalCount ?? prev.totalCount,
          totalMinutes: r.totalMinutes ?? prev.totalMinutes,
          items: [...(prev.items || []), ...(r.items || [])],
          nextCursor: r.nextCursor,
          hasMore: r.hasMore,
        };
      });
    } catch (e: any) {
      setDetailError(e?.message || '추가 로드 실패');
    } finally {
      setDetailMoreLoading(false);
    }
  }

  useEffect(() => { load(); }, [days, team, user]);

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
    if (typeof window === 'undefined') return;
    if (typeof document === 'undefined') return;
    if (!detailOpen) return;

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
  }, [detailOpen]);

  const maxCount = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const t of data.teams) {
      for (const mbr of t.members) m = Math.max(m, mbr.count);
    }
    return m;
  }, [data]);

  const maxMinutes = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const t of data.teams) {
      for (const mbr of t.members) m = Math.max(m, mbr.minutes);
    }
    return m;
  }, [data]);

  const fmtDateOnly = (s?: string) => (s ? new Date(s).toLocaleDateString() : '');

  const teamOptions = useMemo(() => {
    const s = new Set<string>();
    if (data) {
      for (const t of data.teams) s.add(t.teamName);
    }
    return Array.from(s);
  }, [data]);

  const userOptions = useMemo(() => {
    const s = new Set<string>();
    if (data) {
      for (const t of data.teams) {
        if (!team || t.teamName === team) {
          for (const m of t.members) s.add(m.userName);
        }
      }
    }
    return Array.from(s);
  }, [data, team]);

  return (
    <div className="content" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(220px, 1fr)) auto', alignItems: 'center', width: '100%' }}>
          <select value={team} onChange={(e) => { setTeam(e.target.value); }} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}>
            <option value="">전체 팀</option>
            {teamOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={user} onChange={(e) => setUser(e.target.value)} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}>
            <option value="">전체 구성원</option>
            {userOptions.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any, width: '100%' }}>
            <option value={7}>최근 7일</option>
            <option value={14}>최근 14일</option>
            <option value={30}>최근 30일</option>
          </select>
          <button className="btn" onClick={load} disabled={loading}>{loading ? '새로고침…' : '새로고침'}</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {!data && !loading && <div style={{ color: '#64748b' }}>데이터가 없습니다.</div>}
      {data && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ color: '#475569' }}>기간: {new Date(data.from).toLocaleString()} ~ {new Date(data.to).toLocaleString()} · 합계 {data.total}건</div>
          <div style={{ display: 'grid', gap: 12 }}>
            {data.teams.map((t) => (
              <div key={t.teamName} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <h3 style={{ margin: 0 }}>{t.teamName}</h3>
                  <span style={{ fontSize: 12, color: '#64748b' }}>총 {t.total}건</span>
                  <span style={{ fontSize: 12, color: '#64748b' }}>· 총 {formatMinutesAsHmKo(t.members.reduce((s, m) => s + (m.minutes || 0), 0))}</span>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {t.members.map((m) => {
                    const ratio = maxCount > 0 ? (m.count / maxCount) : 0;
                    const width = Math.max(4, Math.round(ratio * 100));
                    const mRatio = maxMinutes > 0 ? (m.minutes / maxMinutes) : 0;
                    const mWidth = Math.max(4, Math.round(mRatio * 100));
                    const recent = Array.isArray(m.recent) ? m.recent : [];
                    return (
                      <button
                        key={m.userName}
                        type="button"
                        onClick={() => openMember(t.teamName, m.userName)}
                        style={{ display: 'grid', gap: 6, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ fontWeight: 600 }}>{m.userName}</div>
                        </div>

                        {recent.length ? (
                          <div style={{ display: 'grid', gap: 4 }}>
                            {recent.map((r) => (
                              <div key={r.id} style={{ display: 'flex', gap: 10, fontSize: 12, color: '#334155', alignItems: 'baseline' }}>
                                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{r.title}</div>
                                <div style={{ marginLeft: 'auto', color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDateOnly(r.date || r.createdAt)}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>최근 업무일지 없음</div>
                        )}

                        <div style={{ color: '#475569', fontSize: 12 }}>{m.count}건 · {formatMinutesAsHmKo(m.minutes)}</div>

                        <div style={{ height: 12, background: '#f1f5f9', borderRadius: 999 }}>
                          <div style={{ width: `${width}%`, height: 12, background: '#0F3D73', borderRadius: 999 }} />
                        </div>
                        <div style={{ height: 12, background: '#f1f5f9', borderRadius: 999 }}>
                          <div style={{ width: `${mWidth}%`, height: 12, background: '#16a34a', borderRadius: 999 }} />
                        </div>
                      </button>
                    );
                  })}
                  {t.members.length === 0 && <div style={{ color: '#94a3b8' }}>구성원 데이터가 없습니다.</div>}
                </div>
              </div>
            ))}
            {data.teams.length === 0 && <div style={{ color: '#94a3b8' }}>팀 데이터가 없습니다.</div>}
          </div>
        </div>
      )}

      {detailOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16, boxSizing: 'border-box' }}
          onClick={() => { setDetailOpen(false); setDetail(null); setSelectedWorklogId(null); setDetailCtx(null); }}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 0, width: 'min(1100px, 96vw)', height: 'min(85vh, 920px)', maxHeight: 'calc(100vh - 32px)', display: 'grid', gridTemplateRows: '44px 1fr', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontWeight: 800 }}>
                업무일지 목록
                {detailCtx ? ` · ${detailCtx.teamName} / ${detailCtx.userName}` : ''}
              </div>
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => { setDetailOpen(false); setDetail(null); setSelectedWorklogId(null); setDetailCtx(null); }}>닫기</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '420px 1fr', height: '100%' }}>
              <div style={{ borderRight: isMobile ? 'none' : '1px solid #e5e7eb', overflow: 'auto' }}>
                <div style={{ padding: 12 }}>
                  {detailLoading && <div style={{ color: '#64748b' }}>불러오는 중...</div>}
                  {detailError && <div style={{ color: 'red' }}>{detailError}</div>}
                  {detail && (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        기간: {formatKstDatetime(detail.from)} ~ {formatKstDatetime(detail.to)} · {detail.totalCount}건 · {formatMinutesAsHmKo(detail.totalMinutes)}
                      </div>
                      {detail.hasMore && detail.nextCursor ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={loadMoreDetail}
                          disabled={detailMoreLoading}
                          style={{ width: '100%' }}
                        >
                          {detailMoreLoading ? '불러오는 중…' : '더보기'}
                        </button>
                      ) : null}
                      <div style={{ display: 'grid', gap: 8 }}>
                        {groupedDetail.map((obj) => (
                          <div key={obj.objectiveTitle} style={{ display: 'grid', gap: 8 }}>
                            <div style={{ fontWeight: 800, color: '#0f172a', marginTop: 6 }}>
                              {obj.objectiveTitle}
                              <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>· {obj.totalCount}건 · {formatMinutesAsHmKo(obj.totalMinutes)}</span>
                            </div>
                            {obj.keyResults.map((kr) => (
                              <div key={kr.keyResultTitle} style={{ display: 'grid', gap: 8, paddingLeft: 8 }}>
                                <div style={{ fontWeight: 700, color: '#334155' }}>
                                  KR: {kr.keyResultTitle}
                                  <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>· {kr.totalCount}건 · {formatMinutesAsHmKo(kr.totalMinutes)}</span>
                                </div>
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                                    gap: 8,
                                  }}
                                >
                                  {kr.items.map((it: DetailItem) => (
                                    <button
                                      key={it.id}
                                      type="button"
                                      onClick={() => setSelectedWorklogId(it.id)}
                                      style={{
                                        textAlign: 'left',
                                        border: selectedWorklogId === it.id ? '2px solid #0F3D73' : '1px solid #e5e7eb',
                                        borderRadius: 10,
                                        padding: 10,
                                        background: '#fff',
                                        cursor: 'pointer',
                                        display: 'grid',
                                        gap: 6,
                                        minHeight: 86,
                                      }}
                                    >
                                      <div style={{ fontWeight: 800, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title || '(제목 없음)'}</div>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, color: '#64748b' }}>
                                        <div style={{ whiteSpace: 'nowrap' }}>{formatKstDatetime(it.createdAt)}</div>
                                        <div style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>{formatMinutesAsHmKo(it.timeSpentMinutes)}</div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                        {detail.items.length === 0 && <div style={{ color: '#94a3b8' }}>업무일지가 없습니다.</div>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ overflow: 'hidden' }}>
                {selectedWorklogId ? (
                  <iframe
                    title="worklog-detail"
                    src={`/worklogs/${encodeURIComponent(selectedWorklogId)}?embed=1`}
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                ) : (
                  <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>왼쪽에서 업무일지를 선택하면 상세가 표시됩니다.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
