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
                    <td style={numCell}>{it.BLUE}</td>
                    <td style={numCell}>{it.GREEN}</td>
                    <td style={numCell}>{it.YELLOW}</td>
                    <td style={numCell}>{it.RED}</td>
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
    </div>
  );
}
