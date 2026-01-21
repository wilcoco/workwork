import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type MonthlyRow = {
  orgUnitId: string;
  orgUnitName: string;
  BLUE: number;
  GREEN: number;
  YELLOW: number;
  RED: number;
  score: number;
};

type MonthlyResponse = {
  month: string;
  items: MonthlyRow[];
  totals: { BLUE: number; GREEN: number; YELLOW: number; RED: number; score: number };
};

type DrilldownDailyItem = {
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

type DrilldownGroup = {
  ymd: string;
  count: number;
  minutes: number;
  items: DrilldownDailyItem[];
};

type DrilldownResponse = {
  month: string;
  orgUnitId: string;
  status: 'BLUE' | 'GREEN' | 'YELLOW' | 'RED';
  ymds: string[];
  groups: DrilldownGroup[];
};

export function WorklogEvalMonthly() {
  const myUserId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [data, setData] = useState<MonthlyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const [drillOpen, setDrillOpen] = useState(false);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  const [drillTitle, setDrillTitle] = useState<string>('');
  const [drillData, setDrillData] = useState<DrilldownResponse | null>(null);

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

  async function openDrilldown(orgUnitId: string, orgUnitName: string, status: 'BLUE' | 'GREEN' | 'YELLOW' | 'RED') {
    if (!myUserId) return;
    if (!orgUnitId) return;
    setDrillOpen(true);
    setDrillLoading(true);
    setDrillError(null);
    setDrillData(null);
    setDrillTitle(`${orgUnitName || orgUnitId} · ${status}`);
    try {
      const r = await apiJson<DrilldownResponse>(
        `/api/worklog-evals/team-monthly-drilldown?userId=${encodeURIComponent(myUserId)}&month=${encodeURIComponent(month)}&orgUnitId=${encodeURIComponent(orgUnitId)}&status=${encodeURIComponent(status)}`
      );
      setDrillData(r);
    } catch (e: any) {
      setDrillError(e?.message || '상세 조회 실패');
    } finally {
      setDrillLoading(false);
    }
  }

  function closeDrilldown() {
    setDrillOpen(false);
    setDrillLoading(false);
    setDrillError(null);
    setDrillTitle('');
    setDrillData(null);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function load() {
    if (!myUserId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiJson<MonthlyResponse>(`/api/worklog-evals/team-monthly?userId=${encodeURIComponent(myUserId)}&month=${encodeURIComponent(month)}`);
      setData(r);
    } catch (e: any) {
      setError(e?.message || '월간 평가 리포트를 불러오지 못했습니다');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    return (data?.items || []).slice();
  }, [data?.items]);

  const headerCell: CSSProperties = { borderBottom: '1px solid #e5e7eb', textAlign: 'left', padding: 6, whiteSpace: 'nowrap' };
  const numCell: CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: 6, textAlign: 'right', whiteSpace: 'nowrap' };
  const leftCell: CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: 6, textAlign: 'left' };
  const linkBtn: CSSProperties = { background: 'transparent', border: 0, padding: 0, margin: 0, color: '#2563eb', cursor: 'pointer', fontWeight: 900 };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>업무 평가 월 리포트</h2>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>월</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}

      {loading ? (
        <div>리포트 로딩중…</div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            합계: 파랑 {data?.totals?.BLUE ?? 0} · 초록 {data?.totals?.GREEN ?? 0} · 노랑 {data?.totals?.YELLOW ?? 0} · 빨강 {data?.totals?.RED ?? 0} · 점수 {data?.totals?.score ?? 0}
          </div>
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={headerCell}>팀</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>파랑(2)</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>초록(1)</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>노랑(0)</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>빨강(-1)</th>
                  <th style={{ ...headerCell, textAlign: 'right' }}>점수</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => (
                  <tr key={it.orgUnitId}>
                    <td style={leftCell}>{it.orgUnitName || it.orgUnitId}</td>
                    <td style={numCell}>
                      {it.BLUE > 0 ? (
                        <button type="button" style={linkBtn} onClick={() => openDrilldown(it.orgUnitId, it.orgUnitName, 'BLUE')}>{it.BLUE}</button>
                      ) : (
                        <span>{it.BLUE}</span>
                      )}
                    </td>
                    <td style={numCell}>
                      {it.GREEN > 0 ? (
                        <button type="button" style={linkBtn} onClick={() => openDrilldown(it.orgUnitId, it.orgUnitName, 'GREEN')}>{it.GREEN}</button>
                      ) : (
                        <span>{it.GREEN}</span>
                      )}
                    </td>
                    <td style={numCell}>
                      {it.YELLOW > 0 ? (
                        <button type="button" style={linkBtn} onClick={() => openDrilldown(it.orgUnitId, it.orgUnitName, 'YELLOW')}>{it.YELLOW}</button>
                      ) : (
                        <span>{it.YELLOW}</span>
                      )}
                    </td>
                    <td style={numCell}>
                      {it.RED > 0 ? (
                        <button type="button" style={linkBtn} onClick={() => openDrilldown(it.orgUnitId, it.orgUnitName, 'RED')}>{it.RED}</button>
                      ) : (
                        <span>{it.RED}</span>
                      )}
                    </td>
                    <td style={{ ...numCell, fontWeight: 900, color: it.score >= 0 ? '#0f172a' : '#991b1b' }}>{it.score}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 10, color: '#94a3b8' }}>데이터가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {drillOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16, boxSizing: 'border-box' }}
          onClick={closeDrilldown}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 0, width: 'min(980px, 96vw)', height: 'min(80vh, 920px)', maxHeight: 'calc(100vh - 32px)', display: 'grid', gridTemplateRows: '44px 1fr', overflow: 'hidden' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontWeight: 900 }}>{drillTitle}</div>
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={closeDrilldown}>닫기</button>
            </div>
            <div style={{ overflow: 'auto', padding: 12, display: 'grid', gap: 10 }}>
              {drillError && <div style={{ color: 'red' }}>{drillError}</div>}
              {drillLoading ? (
                <div>조회중…</div>
              ) : (
                <>
                  {(drillData?.groups || []).map((g) => (
                    <div key={g.ymd} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 10, background: '#fff', display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 900, color: '#0f172a' }}>{g.ymd}</div>
                        <div style={{ fontSize: 12, color: '#64748b' }}>· {g.count}건 · {Math.floor((g.minutes || 0) / 60)}시간 {Number(g.minutes || 0) % 60}분</div>
                      </div>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {(g.items || []).map((it) => (
                          <a
                            key={it.id}
                            href={`/worklogs/${it.id}`}
                            style={{ textDecoration: 'none', color: 'inherit', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, background: '#fff', display: 'grid', gap: 4 }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                              <div style={{ fontWeight: 900, color: '#0f172a' }}>{it.title || '(제목 없음)'}</div>
                              <div style={{ fontSize: 12, color: '#64748b' }}>· {it.teamName || ''} · {it.userName || ''}</div>
                              <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{new Date(it.createdAt).toLocaleString()}</div>
                            </div>
                            {it.excerpt ? <div style={{ color: '#334155', lineHeight: 1.45 }}>{it.excerpt}</div> : null}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                  {(drillData?.groups || []).length === 0 && <div style={{ color: '#94a3b8' }}>데이터가 없습니다.</div>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
