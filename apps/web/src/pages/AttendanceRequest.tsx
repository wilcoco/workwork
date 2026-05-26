import { useEffect, useMemo, useState } from 'react';
import { ApproverIdPicker } from '../components/MemberSearchPicker';
import { apiJson } from '../lib/api';

type AttendanceType = 'OT' | 'VACATION' | 'EARLY_LEAVE' | 'FLEXIBLE' | 'HOLIDAY_WORK' | 'HOLIDAY_REST';

type CalendarItem = {
  id: string;
  userId?: string;
  type: AttendanceType;
  date: string; // ISO date string
  startAt?: string | null;
  endAt?: string | null;
  reason?: string | null;
  requesterName?: string | null;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
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
  const [startDatetime, setStartDatetime] = useState(''); // datetime-local: YYYY-MM-DDTHH:MM
  const [endDatetime, setEndDatetime] = useState('');     // datetime-local: YYYY-MM-DDTHH:MM
  const [vacationDate, setVacationDate] = useState('');   // 휴가용: YYYY-MM-DD
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [altRestDate, setAltRestDate] = useState(''); // 휴일 대체 신청용: 같은 주 평일 휴식일

  const [approvers, setApprovers] = useState<Approver[]>([]);
  // Ordered approval line. Each entry is a userId; the first entry is
  // the immediate approver, the last entry is the final approver. An
  // empty string is allowed at the tail of the array as the
  // not-yet-picked slot for the next stage.
  const [approverIds, setApproverIds] = useState<string[]>(['']);
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

  // 주간 근무시간 계산용 date 추출
  const dateForWeekly = type === 'VACATION' ? vacationDate : (startDatetime ? startDatetime.slice(0, 10) : '');
  const startTimeForWeekly = startDatetime ? startDatetime.slice(11, 16) : '';
  const endTimeForWeekly = endDatetime ? endDatetime.slice(11, 16) : '';

  useEffect(() => {
    if (!userId || !dateForWeekly) {
      setWeeklyHours(null);
      return;
    }
    void (async () => {
      setWeeklyLoading(true);
      try {
        const params = new URLSearchParams({
          userId,
          date: dateForWeekly,
        });
        if (type) params.set('type', type);
        if (type !== 'VACATION' && startTimeForWeekly && endTimeForWeekly) {
          params.set('startTime', startTimeForWeekly);
          params.set('endTime', endTimeForWeekly);
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
  }, [userId, dateForWeekly, type, startTimeForWeekly, endTimeForWeekly]);

  // FLEXIBLE: 시작 시간만 입력받고 종료시간은 +9시간으로 자동 설정
  useEffect(() => {
    if (type !== 'FLEXIBLE') return;
    if (!startDatetime) return;
    const startDate = new Date(startDatetime + ':00');
    if (isNaN(startDate.getTime())) return;
    const endDate = new Date(startDate.getTime() + 9 * 60 * 60 * 1000);
    const endStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
    if (endStr !== endDatetime) setEndDatetime(endStr);
  }, [type, startDatetime, endDatetime]);

  // 근태 유형 변경 시 기본 시작 시간을 설정
  useEffect(() => {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (type === 'OT') {
      if (!startDatetime) setStartDatetime(`${dateStr}T17:00`);
    } else if (type === 'FLEXIBLE') {
      if (!startDatetime) setStartDatetime(`${dateStr}T10:00`);
    }
  }, [type, startDatetime]);

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
    // 반려/취소된 건은 캘린더에서 제외
    const active = items.filter((it) => it.status !== 'REJECTED' && it.status !== 'CANCELLED');
    if (filterType === 'ALL') return active;
    return active.filter((it) => it.type === filterType);
  }, [items, filterType]);

  const weeks = useMemo(() => buildMonthGrid(calendarMonth, filteredItems, holidays), [calendarMonth, filteredItems, holidays]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) {
      alert('로그인이 필요합니다');
      return;
    }
    // 휴가는 vacationDate, 그 외는 startDatetime 필요
    if (type === 'VACATION') {
      if (!vacationDate) {
        alert('휴가 날짜를 입력해 주세요');
        return;
      }
    } else {
      if (!startDatetime || !endDatetime) {
        alert('시작/종료 일시를 입력해 주세요');
        return;
      }
    }
    if (type === 'HOLIDAY_WORK') {
      if (!altRestDate) {
        alert('대체 휴일(같은 주 평일)을 선택해 주세요');
        return;
      }
    }
    const cleanedApprovers = approverIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (cleanedApprovers.length === 0) {
      alert('결재선에 최소 한 명의 승인자를 선택해 주세요');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // 휴가는 date만, 그 외는 startAt/endAt (datetime-local + KST)
      const payload: Record<string, any> = {
        userId,
        approverId: cleanedApprovers[0],
        approverIds: cleanedApprovers,
        type,
        reason: reason || undefined,
      };

      if (type === 'VACATION') {
        payload.date = vacationDate;
      } else {
        // datetime-local 값을 KST ISO 문자열로 변환
        payload.startAt = startDatetime + ':00+09:00';
        payload.endAt = endDatetime + ':00+09:00';
        // 기존 API 호환을 위한 date 필드 (시작일 기준)
        payload.date = startDatetime.slice(0, 10);
      }

      if (type === 'HOLIDAY_WORK') {
        payload.altRestDate = altRestDate;
      }

      await apiJson(`/api/attendance`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadCalendar();
      alert('근태 신청이 등록되었습니다');
      // 폼 초기화
      setStartDatetime('');
      setEndDatetime('');
      setVacationDate('');
      setReason('');
      setAltRestDate('');
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
                                  border: ev.overLimit ? '2px solid #dc2626' : '1px solid #cbd5e1',
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
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>결재선</span>
          {/* Ordered approval line. Stage 1 is the immediate approver,
              the last stage is the final approver. Add/remove stages
              as the org's policy requires. */}
          <div style={{ display: 'grid', gap: 6 }}>
            {approverIds.map((aid, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ minWidth: 56, fontSize: 12, color: '#475569', fontWeight: 700 }}>
                  {idx + 1}단계
                </span>
                <ApproverIdPicker
                  value={aid}
                  onChange={(v) => setApproverIds((prev) => prev.map((p, i) => (i === idx ? v : p)))}
                  members={members}
                  placeholder="이름 검색"
                />
                <button
                  type="button"
                  onClick={() => setApproverIds((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={approverIds.length <= 1}
                  style={{
                    padding: '4px 8px',
                    fontSize: 12,
                    border: '1px solid #CBD5E1',
                    borderRadius: 6,
                    background: '#fff',
                    cursor: approverIds.length <= 1 ? 'not-allowed' : 'pointer',
                    color: approverIds.length <= 1 ? '#cbd5e1' : '#475569',
                  }}
                  title="이 단계 삭제"
                >
                  −
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setApproverIds((prev) => [...prev, ''])}
              style={{
                justifySelf: 'start',
                padding: '4px 10px',
                fontSize: 12,
                border: '1px dashed #94a3b8',
                borderRadius: 6,
                background: '#fff',
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              + 결재자 추가
            </button>
          </div>
        </div>
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
        {type === 'VACATION' ? (
          <label style={{ display: 'grid', gap: 4 }}>
            <span>휴가 일자</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="date" value={vacationDate} onChange={(e) => setVacationDate(e.target.value)} />
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
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'grid', gap: 4, flex: 1, minWidth: 180 }}>
                <span>시작 일시</span>
                <input
                  type="datetime-local"
                  value={startDatetime}
                  onChange={(e) => setStartDatetime(e.target.value)}
                  style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14 }}
                />
              </label>
              <label style={{ display: 'grid', gap: 4, flex: 1, minWidth: 180 }}>
                <span>종료 일시</span>
                <input
                  type="datetime-local"
                  value={endDatetime}
                  onChange={(e) => setEndDatetime(e.target.value)}
                  disabled={type === 'FLEXIBLE'}
                  style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14 }}
                />
              </label>
            </div>
            <div style={{ fontSize: 12, color: '#475569', display: 'flex', flexDirection: 'column' }}>
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
            </div>
          </>
        )}
        {type === 'HOLIDAY_WORK' && (
          <label style={{ display: 'grid', gap: 4 }}>
            <span>대체 휴일 (같은 주 평일)</span>
            <input
              type="date"
              value={altRestDate}
              onChange={(e) => setAltRestDate(e.target.value)}
            />
            {startDatetime && (
              <span style={{ fontSize: 11, color: '#64748b' }}>
                ※ 주 단위: 토~금 기준. 휴일 근무일과 같은 주 내 평일(월~금)을 선택하세요.
              </span>
            )}
          </label>
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
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {selectedEvent && (selectedEvent.ev.status === 'PENDING') && selectedEvent.ev.userId === userId && (
                <button
                  type="button"
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #f87171', background: '#fff', color: '#dc2626', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
                  onClick={async () => {
                    if (!confirm('신청을 취소하시겠습니까?')) return;
                    try {
                      await apiJson(`/api/attendance/${selectedEvent.ev.id}/cancel`, { method: 'PATCH', body: JSON.stringify({ userId }) });
                      setSelectedEvent(null);
                      void loadCalendar();
                    } catch (e: any) {
                      alert(e?.message || '취소 실패');
                    }
                  }}
                >
                  신청 취소
                </button>
              )}
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
  // 신청 종류별 기본 색상 (RGB)
  const typeColors: Record<string, string> = {
    OT: '59, 130, 246',           // 파랑
    VACATION: '34, 197, 94',      // 초록
    EARLY_LEAVE: '249, 115, 22',  // 주황
    FLEXIBLE: '168, 85, 247',     // 보라
    HOLIDAY_WORK: '236, 72, 153', // 핑크
    HOLIDAY_REST: '20, 184, 166', // 청록
  };

  const rgb = typeColors[ev.type || ''] || '100, 116, 139'; // 기본 회색

  // 승인 = 진하게(0.7), 신청중 = 투명하게(0.3)
  const alpha = ev.status === 'APPROVED' ? 0.7 : 0.3;

  return `rgba(${rgb}, ${alpha})`;
}
