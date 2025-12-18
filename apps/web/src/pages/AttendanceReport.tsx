import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type WeeklyRow = {
  weekKey: string;
  weeklyHours: number;
};

type ReportRow = {
  userId: string;
  userName: string;
  otHoursTotal: number;
  vacationDays: number;
  earlyLeaveHoursTotal: number;
  weekly: WeeklyRow[];
};

export function AttendanceReport() {
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<ReportRow[]>([]);
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
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: ReportRow[] }>(`/api/attendance/monthly-report?month=${encodeURIComponent(month)}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '근태 리포트를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    return items.map((it) => {
      const maxWeekly = it.weekly.reduce((m, w) => Math.max(m, w.weeklyHours), 0);
      const avgWeekly = it.weekly.length ? (it.weekly.reduce((s, w) => s + w.weeklyHours, 0) / it.weekly.length) : 0;
      return { ...it, maxWeekly, avgWeekly };
    });
  }, [items]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>근태 월 리포트</h2>
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>월</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {loading ? (
        <div>리포트 로딩중…</div>
      ) : (
        <div style={{ width: '100%', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left', padding: 4 }}>구성원</th>
                <th style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'right', padding: 4 }}>총 OT시간</th>
                <th style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'right', padding: 4 }}>총 조퇴시간</th>
                <th style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'right', padding: 4 }}>휴가일수</th>
                <th style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'right', padding: 4 }}>평균 주당 근무시간</th>
                <th style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left', padding: 4 }}>주별 근무시간</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((it) => (
                <tr key={it.userId}>
                  <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4 }}>{it.userName || it.userId}</td>
                  <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4, textAlign: 'right' }}>{it.otHoursTotal.toFixed(1)}</td>
                  <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4, textAlign: 'right' }}>{it.earlyLeaveHoursTotal.toFixed(1)}</td>
                  <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4, textAlign: 'right' }}>{it.vacationDays}</td>
                  <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4, textAlign: 'right' }}>{it.avgWeekly.toFixed(1)}</td>
                  <td style={{ borderBottom: '1px solid #f1f5f9', padding: 4 }}>
                    {it.weekly.map((w) => `${w.weekKey}: ${w.weeklyHours.toFixed(1)}h`).join(' / ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
