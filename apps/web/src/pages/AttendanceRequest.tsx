import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type AttendanceType = 'OT' | 'VACATION' | 'EARLY_LEAVE' | 'FLEXIBLE';

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
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('21:00');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [approverId, setApproverId] = useState('');
  const [members, setMembers] = useState<Approver[]>([]);
  const [filterUserId, setFilterUserId] = useState(''); // 캘린더용 구성원 필터 (''이면 전체)

  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  useEffect(() => {
    void loadApprovers();
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);

  // 최초 로드 시 캘린더 필터 기본값을 본인으로 설정
  useEffect(() => {
    if (userId && !filterUserId) setFilterUserId(userId);
  }, [userId, filterUserId]);

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
    if (!approverId) {
      alert('승인자를 선택해 주세요');
      return;
    }
    if ((type === 'OT' || type === 'EARLY_LEAVE' || type === 'FLEXIBLE') && (!startTime || !endTime)) {
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <button type="button" onClick={() => changeMonth(-1)} style={{ marginRight: 8 }}>◀</button>
            <b>{calendarMonth}</b>
            <button type="button" onClick={() => changeMonth(1)} style={{ marginLeft: 8 }}>▶</button>
          </div>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>구성원</span>
            <select
              value={filterUserId}
              onChange={(e) => {
                setFilterUserId(e.target.value);
                void loadCalendar();
              }}
            >
              <option value="">전체</option>
              {members.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
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
                                  background: getBg(ev),
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
  let base: string;
  if (ev.type === 'VACATION') {
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
