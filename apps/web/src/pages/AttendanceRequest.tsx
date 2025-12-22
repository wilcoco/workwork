import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type AttendanceType = 'OT' | 'VACATION' | 'EARLY_LEAVE' | 'FLEXIBLE' | 'HOLIDAY_WORK' | 'HOLIDAY_REST';

type CalendarItem = {
  id: string;
  type: AttendanceType;
  date: string; // ISO date string
  startAt?: string | null;
  endAt?: string | null;
  reason?: string | null;
  requesterName?: string | null;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  overLimit: boolean;
};

type Approver = {
  id: string;
  name: string;
  role: string;
};

export function AttendanceRequest() {
  const [calendarMonth, setCalendarMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weeklyHours, setWeeklyHours] = useState<number | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyDays, setWeeklyDays] = useState<{ date: string; totalHours: number }[]>([]);

  const [type, setType] = useState<AttendanceType>('OT');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('21:00');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [altRestDate, setAltRestDate] = useState(''); // 휴일 대체 신청용: 같은 주 평일 휴식일

  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [approverId, setApproverId] = useState('');
  const [members, setMembers] = useState<Approver[]>([]);
  const [filterUserId, setFilterUserId] = useState(''); // 캘린더용 구성원 필터 (''이면 전체)
  const [filterType, setFilterType] = useState<'ALL' | AttendanceType>('ALL');
  const [holidays, setHolidays] = useState<string[]>([]); // YYYY-MM-DD 목록
  const [isMobile, setIsMobile] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<{ ev: CalendarItem; dateLabel: string } | null>(null);

  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  useEffect(() => {
    void loadApprovers();
    void loadCalendar();
    void loadHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth, filterUserId]);

  // 최초 로드 시 캘린더 필터 기본값을 본인으로 설정
  useEffect(() => {
    if (userId && !filterUserId) setFilterUserId(userId);
  }, [userId, filterUserId]);

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

  async function loadApprovers() {
    try {
      const res = await apiJson<{ items: { id: string; name: string; role: string }[] }>(`/api/users`);
      const all = res.items || [];
      setMembers(all);
      const cand = all.filter((u) => u.role === 'CEO' || u.role === 'EXEC' || u.role === 'MANAGER');
      setApprovers(cand);
      if (!approverId && cand.length > 0) {
        const hong = cand.find((u) => u.name === '홍정수');
        setApproverId((hong ?? cand[0]).id);
      }
    } catch (e) {
      // 승인자 목록은 필수까지는 아니라서 조용히 무시
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  async function loadHolidays() {
    try {
      const [yStr] = calendarMonth.split('-');
      const year = parseInt(yStr, 10);
      if (!year || Number.isNaN(year)) return;
      const res = await apiJson<{ items: { date: string }[] }>(`/api/holidays?year=${year}`);
      const days = (res.items || []).map((h) => (h.date || '').slice(0, 10)).filter(Boolean);
      setHolidays(days);
    } catch (e) {
      // 공휴일 정보는 보조용이므로 실패해도 치명적이지 않다.
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  useEffect(() => {
    if (!userId || !date) {
      setWeeklyHours(null);
      return;
    }
    void (async () => {
      setWeeklyLoading(true);
      try {
        const params = new URLSearchParams({
          userId,
          date,
        });
        if (type) params.set('type', type);
        if (type !== 'VACATION' && startTime && endTime) {
          params.set('startTime', startTime);
          params.set('endTime', endTime);
        }
        const res = await apiJson<{ weeklyHours: number; days?: { date: string; totalHours: number }[] }>(`/api/attendance/weekly-hours?${params.toString()}`);
        setWeeklyHours(typeof res.weeklyHours === 'number' ? res.weeklyHours : null);
        setWeeklyDays(Array.isArray(res.days) ? res.days : []);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(e);
        setWeeklyHours(null);
        setWeeklyDays([]);
      } finally {
        setWeeklyLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, date, type, startTime, endTime]);

  // FLEXIBLE: 시작 시간만 입력받고 종료시간은 +9시간으로 자동 설정
  useEffect(() => {
    if (type !== 'FLEXIBLE') return;
    if (!startTime) return;
    const [h, m] = startTime.split(':').map((v) => parseInt(v, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const endH = (h + 9) % 24;
    const end = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    if (end !== endTime) setEndTime(end);
  }, [type, startTime, endTime]);

  // 근태 유형 변경 시 기본 시작 시간을 설정
  useEffect(() => {
    if (type === 'OT') {
      setStartTime('17:00');
    } else if (type === 'FLEXIBLE') {
      setStartTime('10:00');
    }
  }, [type]);

  async function loadCalendar() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month: calendarMonth });
      if (filterUserId) params.set('userId', filterUserId);
      const res = await apiJson<{ items: CalendarItem[] }>(`/api/attendance/calendar?${params.toString()}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '근태 달력을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = useMemo(() => {
    if (filterType === 'ALL') return items;
    return items.filter((it) => it.type === filterType);
  }, [items, filterType]);

  const weeks = useMemo(() => buildMonthGrid(calendarMonth, filteredItems, holidays), [calendarMonth, filteredItems, holidays]);

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
    if (type === 'HOLIDAY_WORK') {
      if (!altRestDate) {
        alert('대체 휴일(같은 주 평일)을 선택해 주세요');
        return;
      }
    }
    if (!approverId) {
      alert('승인자를 선택해 주세요');
      return;
    }
    if ((type === 'OT' || type === 'EARLY_LEAVE' || type === 'FLEXIBLE' || type === 'HOLIDAY_WORK') && (!startTime || !endTime)) {
      alert('시간을 입력해 주세요');
      return;
    }

    if (weeklyHours !== null && weeklyHours > 52) {
      alert('해당 주 업무시간이 52시간을 초과하여 신청할 수 없습니다');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiJson(`/api/attendance`, {
        method: 'POST',
        body: JSON.stringify({
          userId,
          approverId,
          type,
          date,
          startTime: type === 'VACATION' ? undefined : startTime,
          endTime: type === 'VACATION' ? undefined : endTime,
          reason: reason || undefined,
          altRestDate: type === 'HOLIDAY_WORK' ? (altRestDate || undefined) : undefined,
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
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#ffffff' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
            padding: '4px 4px 8px',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => changeMonth(-1)}
              style={{
                marginRight: 2,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 18,
              }}
            >
              ◀
            </button>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{calendarMonth}</span>
            <button
              type="button"
              onClick={() => changeMonth(1)}
              style={{
                marginLeft: 2,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 18,
              }}
            >
              ▶
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'grid', gap: 2 }}>
              <span style={{ color: '#64748b' }}>구성원</span>
              <select
                value={filterUserId}
                onChange={(e) => {
                  setFilterUserId(e.target.value);
                }}
                style={{
                  minWidth: 90,
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid #CBD5E1',
                  fontSize: 12,
                }}
              >
                <option value="">전체</option>
                {members.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'grid', gap: 2 }}>
              <span style={{ color: '#64748b' }}>유형</span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                style={{
                  minWidth: 80,
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid #CBD5E1',
                  fontSize: 12,
                }}
              >
                <option value="ALL">전체</option>
                <option value="OT">OT</option>
                <option value="VACATION">휴가</option>
                <option value="EARLY_LEAVE">조퇴</option>
                <option value="FLEXIBLE">유연근무</option>
              </select>
            </label>
          </div>
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
                    <td
                      key={ci}
                      style={{
                        verticalAlign: 'top',
                        borderBottom: '1px solid #f1f5f9',
                        borderRight: '1px solid #f1f5f9',
                        padding: 4,
                        height: isMobile ? 'auto' : 80,
                      }}
                    >
                      {cell && (
                        <div>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: cell.isHoliday ? 700 : 600,
                              marginBottom: 2,
                              color: cell.isHoliday ? '#dc2626' : undefined,
                            }}
                          >
                            {cell.day}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {cell.items.map(ev => (
                              <div
                                key={ev.id}
                                style={{
                                  fontSize: isMobile ? 8 : 9,
                                  padding: '2px 4px',
                                  borderRadius: 4,
                                  background: getBg(ev),
                                  border: '1px solid #cbd5e1',
                                  overflow: isMobile ? 'visible' : 'hidden',
                                  textOverflow: isMobile ? 'clip' : 'ellipsis',
                                  whiteSpace: 'normal',
                                  cursor: 'pointer',
                                }}
                                title={buildTitle(ev)}
                                onClick={() => {
                                  const dateLabel = `${calendarMonth}-${String(cell.day).padStart(2, '0')}`;
                                  setSelectedEvent({ ev, dateLabel });
                                }}
                              >
                                {getAttendanceTypeLabel(ev)}
                                {ev.requesterName && <><br />{ev.requesterName}</>}
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
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
        <h2>근태 신청</h2>
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
          <span>유형</span>
          <select value={type} onChange={(e) => setType(e.target.value as AttendanceType)}>
            <option value="OT">OT 신청</option>
            <option value="VACATION">휴가 신청</option>
            <option value="EARLY_LEAVE">조퇴 신청</option>
            <option value="FLEXIBLE">유연 근무 신청</option>
            <option value="HOLIDAY_WORK">휴일 대체 신청</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>일자</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <span style={{ fontSize: 12, color: '#475569', display: 'flex', flexDirection: 'column' }}>
              <span>
                해당 주 업무시간:{' '}
                {weeklyLoading ? '계산 중…' : (weeklyHours !== null ? `${weeklyHours.toFixed(1)}시간` : '-')} 
              </span>
              {!weeklyLoading && weeklyDays.length > 0 && (
                <span>
                  {weeklyDays.map((d, idx) => {
                    const label = d.totalHours.toFixed(1);
                    return `${idx > 0 ? ' / ' : ''}${d.date.slice(5)}: ${label}h`;
                  }).join('')}
                </span>
              )}
            </span>
          </div>
        </label>
        {type === 'HOLIDAY_WORK' && (
          <label style={{ display: 'grid', gap: 4 }}>
            <span>대체 휴일 (같은 주 평일)</span>
            <input
              type="date"
              value={altRestDate}
              onChange={(e) => setAltRestDate(e.target.value)}
            />
          </label>
        )}
        {type !== 'VACATION' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, flex: 1 }}>
              <span>시작 시간</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 4, flex: 1 }}>
              <span>종료 시간</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={type === 'FLEXIBLE'}
              />
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
      {selectedEvent ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2500,
            padding: 16,
          }}
          onClick={() => setSelectedEvent(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 16,
              minWidth: 260,
              maxWidth: 360,
              boxShadow: '0 12px 32px rgba(15,23,42,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const { ev, dateLabel } = selectedEvent;
              const typeLabel = getAttendanceTypeLabel(ev);
              const hasTime = ev.startAt || ev.endAt;
              return (
                <>
                  <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>{dateLabel}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                    {typeLabel}{ev.requesterName ? ` - ${ev.requesterName}` : ''}
                  </div>
                  <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                    {ev.requesterName && (
                      <div><strong>신청자</strong> {ev.requesterName}</div>
                    )}
                    {hasTime && (
                      <div>
                        <strong>시간</strong>{' '}
                        {ev.startAt ? formatTime(ev.startAt) : ''}
                        {ev.endAt ? `~${formatTime(ev.endAt)}` : ''}
                      </div>
                    )}
                    {ev.reason && (
                      <div><strong>사유</strong> {ev.reason}</div>
                    )}
                    <div><strong>상태</strong> {ev.status ?? 'PENDING'}</div>
                  </div>
                </>
              );
            })()}
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button type="button" className="btn btn-sm" onClick={() => setSelectedEvent(null)}>닫기</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildMonthGrid(month: string, items: CalendarItem[], holidays: string[]) {
  const [y, m] = month.split('-').map((v) => parseInt(v, 10));
  const first = new Date(y, m - 1, 1);
  const firstWeekday = first.getDay(); // 0=Sun
  const daysInMonth = new Date(y, m, 0).getDate();
  type Cell = { day: number; items: CalendarItem[]; isHoliday: boolean };
  const holidaySet = new Set(holidays);
  const cells: Array<Cell | null> = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const dayDate = new Date(y, m - 1, d);
    const dayStart = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 23, 59, 59, 999);
    const key = dayDate.toISOString().slice(0, 10);
    const dow = dayDate.getDay(); // 0=Sun,6=Sat
    const evs = items.filter((it) => {
      const base = new Date(it.date);
      return base >= dayStart && base <= dayEnd;
    });
    const isHoliday = holidaySet.has(key) || dow === 0 || dow === 6;
    cells.push({ day: d, items: evs, isHoliday });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<Cell | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function buildLabel(ev: CalendarItem): string {
  let t: string;
  if (ev.type === 'OT') t = 'OT';
  else if (ev.type === 'VACATION') t = '휴가';
  else if (ev.type === 'EARLY_LEAVE') t = '조퇴';
  else if (ev.type === 'FLEXIBLE') t = '유연근무';
  else if (ev.type === 'HOLIDAY_WORK') t = '대체 업무일';
  else if (ev.type === 'HOLIDAY_REST') t = '대체 근무일';
  else t = ev.type;

  let base: string;
  if (ev.type === 'VACATION' || ev.type === 'HOLIDAY_REST') {
    base = `${t} (종일)`;
  } else {
    const s = ev.startAt ? formatTime(ev.startAt) : '';
    const e = ev.endAt ? formatTime(ev.endAt) : '';
    base = `${t} ${s}${e ? `~${e}` : ''}`;
  }
  if (ev.requesterName) return `${ev.requesterName} ${base}`;
  return base;
}

function buildTitle(ev: CalendarItem): string {
  const base = buildLabel(ev);
  if (ev.reason) return `${base} · ${ev.reason}`;
  return base;
}

function getAttendanceTypeLabel(ev: CalendarItem): string {
  if (ev.type === 'OT') return 'OT';
  if (ev.type === 'VACATION') return '휴가';
  if (ev.type === 'EARLY_LEAVE') return '조퇴';
  if (ev.type === 'FLEXIBLE') return '유연근무';
  if (ev.type === 'HOLIDAY_WORK') return '대체 업무일';
  if (ev.type === 'HOLIDAY_REST') return '대체 근무일';
  return ev.type;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function getBg(ev: CalendarItem): string {
  // 52시간 초과 경고는 항상 빨간색
  if (ev.overLimit) return '#fee2e2';
  // 결재 상태별 색상
  if (ev.status === 'APPROVED') return '#dcfce7'; // 초록
  if (ev.status === 'REJECTED') return '#fee2e2'; // 빨강
  // PENDING, EXPIRED 등은 노랑
  return '#fef9c3';
}
