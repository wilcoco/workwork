import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type Car = {
  id: string;
  name: string;
  type?: string | null;
};

type Approver = {
  id: string;
  name: string;
  role: string;
};

type CalendarItem = {
  id: string;
  carId: string;
  carName: string;
  startAt: string;
  endAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requesterName: string;
  destination: string;
  purpose: string;
};

export function CarDispatchCorporate() {
  const [cars, setCars] = useState<Car[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [carId, setCarId] = useState('');
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [approverId, setApproverId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [coRiders, setCoRiders] = useState('');
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    void loadCars();
    void loadApprovers();
  }, []);

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
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);

  async function loadCars() {
    try {
      const res = await apiJson<{ items: Car[] }>(`/api/cars`);
      setCars(res.items || []);
      if (!carId && res.items && res.items.length > 0) setCarId(res.items[0].id);
    } catch (e: any) {
      console.error(e);
    }
  }

  async function loadApprovers() {
    try {
      const res = await apiJson<{ items: { id: string; name: string; role: string }[] }>(`/api/users`);
      const cand = (res.items || []).filter((u) => u.role === 'CEO' || u.role === 'EXEC');
      setApprovers(cand);
      if (!approverId && cand.length > 0) {
        const hong = cand.find((u) => u.name === '홍정수');
        setApproverId((hong ?? cand[0]).id);
      }
    } catch (e) {
      // 승인자 목록은 필수까지는 아니라서 조용히 무시
      console.error(e);
    }
  }

  async function loadCalendar() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: CalendarItem[] }>(`/api/car-dispatch/calendar?month=${encodeURIComponent(calendarMonth)}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '배차 달력을 불러오지 못했습니다');
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
    if (!carId || !date || !startTime || !endTime || !destination || !purpose) {
      alert('필수 항목을 입력해 주세요');
      return;
    }
    const startAtIso = toIso(date, startTime);
    const endAtIso = toIso(date, endTime);
    setSubmitting(true);
    setError(null);
    try {
      await apiJson(`/api/car-dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          carId,
          requesterId: userId,
          approverId: approverId || undefined,
          coRiders: coRiders || undefined,
          startAt: startAtIso,
          endAt: endAtIso,
          destination,
          purpose,
        }),
      });
      await loadCalendar();
      alert('배차 신청이 등록되었습니다');
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('이미 배차된 시간')) alert('이미 배차된 시간입니다. 다른 시간대를 선택해 주세요.');
      else alert(msg || '배차 신청에 실패했습니다');
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
    <div className="content" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', alignItems: 'flex-start' }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#ffffff' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <button type="button" onClick={() => changeMonth(-1)} style={{ marginRight: 8 }}>◀</button>
            <b>{calendarMonth}</b>
            <button type="button" onClick={() => changeMonth(1)} style={{ marginLeft: 8 }}>▶</button>
          </div>
          {error && <div style={{ color: 'red', marginBottom: 4 }}>{error}</div>}
          {loading ? (
            <div>달력 로딩중…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    {['일','월','화','수','목','금','토'].map((d) => (
                      <th key={d} style={{ borderBottom: '1px solid #e5e7eb', padding: 3, fontSize: 11 }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, wi) => (
                    <tr key={wi}>
                      {week.map((cell, ci) => (
                        <td key={ci} style={{ verticalAlign: 'top', borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', padding: 3, height: 70 }}>
                          {cell && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{cell.day}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {cell.items.map(ev => (
                                  <div
                                    key={ev.id}
                                    style={{
                                      fontSize: isMobile ? 9 : 10,
                                      padding: '2px 4px',
                                      borderRadius: 4,
                                      background:
                                        ev.status === 'APPROVED'
                                          ? '#dcfce7' // green
                                          : ev.status === 'REJECTED'
                                            ? '#fee2e2' // red
                                            : '#fef9c3', // pending = yellow
                                      border: '1px solid #cbd5e1',
                                      overflow: isMobile ? 'visible' : 'hidden',
                                      textOverflow: isMobile ? 'clip' : 'ellipsis',
                                      whiteSpace: isMobile ? 'normal' : 'nowrap',
                                    }}
                                    title={`${ev.carName} · ${ev.requesterName} · ${formatTime(ev.startAt)}~${formatTime(ev.endAt)} · ${ev.destination} · ${ev.purpose}`}
                                  >
                                    {`${ev.carName} ${ev.requesterName} ${formatTime(ev.startAt)}~${formatTime(ev.endAt)}`}
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
            </div>
          )}
        </div>
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 520, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#ffffff' }}>
          <h2 style={{ marginTop: 0 }}>법인차량 신청</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>차량 선택</span>
          <select value={carId} onChange={(e) => setCarId(e.target.value)}>
            <option value="">선택</option>
            {cars.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.type ? ` (${c.type})` : ''}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>승인자</span>
          <select value={approverId} onChange={(e) => setApproverId(e.target.value)}>
            <option value="">선택</option>
            {approvers.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>필요 일자</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 4, flex: 1 }}>
            <span>시작 시간</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4, flex: 1 }}>
            <span>종료 시간</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>동승자</span>
          <input type="text" placeholder="동승자 이름들" value={coRiders} onChange={(e) => setCoRiders(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>목적지</span>
          <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>목적</span>
          <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <div style={{ marginTop: 8 }}>
          <button type="submit" disabled={submitting}>
            {submitting ? '신청 중…' : '배차 신청'}
          </button>
        </div>
        </form>
      </div>
    </div>
  );
}

function toIso(date: string, time: string): string {
  // date: YYYY-MM-DD, time: HH:MM (interpreted as KST, UTC+9)
  if (!date || !time) return '';
  const isoKst = `${date}T${time}:00+09:00`;
  const d = new Date(isoKst);
  return d.toISOString();
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
      const s = new Date(it.startAt);
      const e = new Date(it.endAt);
      return e >= dayStart && s <= dayEnd;
    });
    cells.push({ day: d, items: evs });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<{ day: number; items: CalendarItem[] } | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}
