import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type AttendanceType = 'OT' | 'VACATION' | 'EARLY_LEAVE';

type CalendarItem = {
  id: string;
  type: AttendanceType;
  date: string; // ISO date string
  startAt?: string | null;
  endAt?: string | null;
  reason?: string | null;
  overLimit: boolean;
};

export function AttendanceRequest() {
  const [calendarMonth, setCalendarMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<AttendanceType>('OT');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('21:00');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  useEffect(() => {
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);

  async function loadCalendar() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: CalendarItem[] }>(`/api/attendance/calendar?month=${encodeURIComponent(calendarMonth)}&userId=${encodeURIComponent(userId)}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '근태 달력을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  const weeks = useMemo(() => buildMonthGrid(calendarMonth, items), [calendarMonth, items]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) {
      alert('로그인이 필요합니다');
      return;
    }
    if (!date || !type) {
      alert('유형과 날짜를 입력해 주세요');
      return;
    }
    if ((type === 'OT' || type === 'EARLY_LEAVE') && (!startTime || !endTime)) {
      alert('시간을 입력해 주세요');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiJson(`/api/attendance`, {
        method: 'POST',
        body: JSON.stringify({
          userId,
          type,
          date,
          startTime: type === 'VACATION' ? undefined : startTime,
          endTime: type === 'VACATION' ? undefined : endTime,
          reason: reason || undefined,
        }),
      });
      await loadCalendar();
      alert('근태 신청이 등록되었습니다');
    } catch (e: any) {
      alert(e?.message || '근태 신청에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  }

  function changeMonth(delta: number) {
    const [y, m] = calendarMonth.split('-').map((v) => parseInt(v, 10));
    const d = new Date(y, (m - 1) + delta, 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setCalendarMonth(next);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <button type="button" onClick={() => changeMonth(-1)} style={{ marginRight: 8 }}>◀</button>
          <b>{calendarMonth}</b>
          <button type="button" onClick={() => changeMonth(1)} style={{ marginLeft: 8 }}>▶</button>
        </div>
        {error && <div style={{ color: 'red', marginBottom: 4 }}>{error}</div>}
        {loading ? (
          <div>달력 로딩중…</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {['일','월','화','수','목','금','토'].map((d) => (
                  <th key={d} style={{ borderBottom: '1px solid #e5e7eb', padding: 4, fontSize: 12 }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, wi) => (
                <tr key={wi}>
                  {week.map((cell, ci) => (
                    <td key={ci} style={{ verticalAlign: 'top', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', padding: 4, height: 80 }}>
                      {cell && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{cell.day}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {cell.items.map(ev => (
                              <div
                                key={ev.id}
                                style={{
                                  fontSize: 10,
                                  padding: '2px 4px',
                                  borderRadius: 4,
                                  background: ev.overLimit ? '#fee2e2' : '#fef9c3',
                                  border: '1px solid #cbd5e1',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={buildTitle(ev)}
                              >
                                {buildLabel(ev)}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
        <h2>근태 신청</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>유형</span>
          <select value={type} onChange={(e) => setType(e.target.value as AttendanceType)}>
            <option value="OT">OT 신청</option>
            <option value="VACATION">휴가 신청</option>
            <option value="EARLY_LEAVE">조퇴 신청</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>일자</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {type !== 'VACATION' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, flex: 1 }}>
              <span>시작 시간</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 4, flex: 1 }}>
              <span>종료 시간</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </div>
        )}
        <label style={{ display: 'grid', gap: 4 }}>
          <span>사유</span>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div style={{ marginTop: 8 }}>
          <button type="submit" disabled={submitting}>
            {submitting ? '신청 중…' : '근태 신청'}
          </button>
        </div>
      </form>
    </div>
  );
}

function buildMonthGrid(month: string, items: CalendarItem[]) {
  const [y, m] = month.split('-').map((v) => parseInt(v, 10));
  const first = new Date(y, m - 1, 1);
  const firstWeekday = first.getDay(); // 0=Sun
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: Array<{ day: number; items: CalendarItem[] } | null> = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dayDate = new Date(y, m - 1, d);
    const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 23, 59, 59, 999);
    const evs = items.filter((it) => {
      const base = new Date(it.date);
      return base >= dayStart && base <= dayEnd;
    });
    cells.push({ day: d, items: evs });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<{ day: number; items: CalendarItem[] } | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function buildLabel(ev: CalendarItem): string {
  const t = ev.type === 'OT' ? 'OT' : ev.type === 'VACATION' ? '휴가' : '조퇴';
  if (ev.type === 'VACATION') return `${t} (종일)`;
  const s = ev.startAt ? formatTime(ev.startAt) : '';
  const e = ev.endAt ? formatTime(ev.endAt) : '';
  return `${t} ${s}${e ? `~${e}` : ''}`;
}

function buildTitle(ev: CalendarItem): string {
  const base = buildLabel(ev);
  if (ev.reason) return `${base} · ${ev.reason}`;
  return base;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
