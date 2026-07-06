import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

const TYPE_LABELS: Record<string, string> = {
  OT: '초과근무(OT)',
  VACATION: '휴가',
  PARENTAL_LEAVE: '육아휴직',
  PUBLIC_DUTY: '공가',
  EARLY_LEAVE: '조기퇴근',
  FLEXIBLE: '유연근무',
  HOLIDAY_WORK: '휴일근무',
  HOLIDAY_REST: '대체휴무',
};

// 일(日) 단위로 집계/표시하는 종일 휴무 유형
const DAY_BASED_TYPES = ['VACATION', 'PARENTAL_LEAVE', 'PUBLIC_DUTY', 'HOLIDAY_REST'];

const STATUS_LABELS: Record<string, string> = {
  PENDING: '대기',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELLED: '취소',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#f59e0b',
  APPROVED: '#22c55e',
  REJECTED: '#ef4444',
  CANCELLED: '#94a3b8',
};

type ApprovalStep = {
  stepNo: number;
  approverName: string;
  status: string;
  decidedAt: string | null;
};

type RecordItem = {
  id: string;
  userId: string;
  userName: string;
  teamName: string;
  type: string;
  date: string;
  endDate: string | null;
  startAt: string | null;
  endAt: string | null;
  hours: number | null;
  otHours?: number | null;   // 휴일근무의 OT 초과분
  compHours?: number | null; // 휴일근무의 대체휴무 맞교환분
  days: number | null;
  status: string;
  reason: string | null;
  baseDate?: string;          // 기준일 (신청일과 다르면 전날)
  baseDateDiffers?: boolean;  // 자정 이후 OT라 기준일=전날
  currentApproverName?: string;
  approvalSteps?: ApprovalStep[];
};

export function AttendanceReport() {
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [myRole, setMyRole] = useState<string>('');
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setRoleLoading(false); return; }
    apiJson<{ role: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`)
      .then((me) => setMyRole(String(me?.role || '').toUpperCase()))
      .catch(() => setMyRole(''))
      .finally(() => setRoleLoading(false));
  }, [userId]);

  const isExec = myRole === 'CEO' || myRole === 'EXEC';

  useEffect(() => {
    if (roleLoading || !userId) return;
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, roleLoading, userId]);

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month, actorId: userId });
      const res = await apiJson<{ items: RecordItem[] }>(`/api/attendance/monthly-report?${params}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '근태 리포트를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string, userName: string) {
    if (!confirm(`${userName}님의 근태 신청을 삭제하시겠습니까?\n\n삭제된 신청은 복구할 수 없습니다.`)) return;
    try {
      await apiJson(`/api/attendance/${id}?actorId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((it) => it.id !== id));
    } catch (e: any) {
      alert(e?.message || '삭제에 실패했습니다');
    }
  }

  const users = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((it) => map.set(it.userId, it.userName || it.userId));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filterType && it.type !== filterType) return false;
      if (filterUser && it.userId !== filterUser) return false;
      return true;
    });
  }, [items, filterType, filterUser]);

  // 휴일근무를 신청한 날(userId+날짜) — 이 날 별도 신청된 OT는 이중신청이라 집계/표시에서 제외
  const holidayWorkDayKeys = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.type === 'HOLIDAY_WORK') s.add(`${it.userId}:${(it.date || '').slice(0, 10)}`);
    return s;
  }, [items]);
  const isDupOt = (it: RecordItem) => it.type === 'OT' && holidayWorkDayKeys.has(`${it.userId}:${(it.date || '').slice(0, 10)}`);

  // Summary: per-user totals
  const summary = useMemo(() => {
    const map = new Map<string, { userName: string; teamName: string; counts: Record<string, number> }>();
    for (const it of filtered) {
      if (!map.has(it.userId)) map.set(it.userId, { userName: it.userName, teamName: it.teamName, counts: {} });
      const entry = map.get(it.userId)!;
      if (it.type === 'HOLIDAY_WORK') {
        // 휴일근무: 8h 맞교환분 → 휴일근무 열, 정규 8h 초과분 → '휴일대체 잔여 OT' 열로 분리
        const comp = it.compHours != null ? it.compHours : (it.hours != null ? Math.min(it.hours, 8) : 0);
        const ot = it.otHours != null ? it.otHours : (it.hours != null ? Math.max(0, it.hours - 8) : 0);
        if (comp) entry.counts['HOLIDAY_WORK'] = (entry.counts['HOLIDAY_WORK'] || 0) + comp;
        if (ot) entry.counts['HOLIDAY_OT'] = (entry.counts['HOLIDAY_OT'] || 0) + ot;
      } else if (it.type === 'OT' && String(it.status).toUpperCase() === 'REJECTED') {
        // 반려된 OT는 집계 제외 (휴일근무 중복 등은 항목별 반려하면 자동 제외)
      } else {
        const key = it.type;
        const val = it.hours != null ? it.hours : (it.days != null ? it.days : 1);
        entry.counts[key] = (entry.counts[key] || 0) + val;
      }
    }
    return Array.from(map.entries()).map(([uid, v]) => ({ userId: uid, ...v }));
  }, [filtered]);

  const allTypes = useMemo(() => {
    const s = new Set(filtered.map((it) => it.type));
    return Object.keys(TYPE_LABELS).filter((t) => s.has(t));
  }, [filtered]);

  // 휴일근무 정규 8h 초과분(= 휴일대체 잔여 OT)이 하나라도 있으면 별도 컬럼 노출
  const hasHolidayOt = useMemo(() => summary.some((r) => (r.counts['HOLIDAY_OT'] || 0) > 0), [summary]);

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '';
  const fmtTime = (d: string | null) => d ? new Date(d).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  const fmtDateTime = (d: string | null) => d ? new Date(d).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

  const th: React.CSSProperties = { borderBottom: '2px solid #e2e8f0', padding: '8px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#475569', background: '#f8fafc', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '7px 10px', fontSize: 13, verticalAlign: 'middle' };

  if (roleLoading) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>권한 확인 중…</div>;
  }

  if (!userId) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
        로그인이 필요합니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{isExec ? '근태 월 리포트' : '내 근태 (월)'}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); }} style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }} />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}>
            <option value="">전체 유형</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {isExec && (
            <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}>
              <option value="">전체 구성원</option>
              {users.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
            </select>
          )}
          <button onClick={() => void loadReport()} style={{ padding: '4px 12px', background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
            조회
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>로딩 중…</div>
      ) : (
        <>
          {/* 요약 테이블 */}
          {!filterType && summary.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>구성원별 요약</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>구성원</th>
                      <th style={th}>팀</th>
                      {allTypes.map((t) => (
                        <th key={t} style={{ ...th, textAlign: 'right' }}>
                          {TYPE_LABELS[t] || t}
                          <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: 2 }}>
                            {DAY_BASED_TYPES.includes(t) ? '(일)' : '(시간)'}
                          </span>
                        </th>
                      ))}
                      {hasHolidayOt && (
                        <th style={{ ...th, textAlign: 'right', color: '#7c3aed' }}>
                          휴일대체 잔여 OT
                          <span style={{ fontWeight: 400, color: '#a78bfa', marginLeft: 2 }}>(시간)</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row) => (
                      <tr key={row.userId}>
                        <td style={td}>{row.userName}</td>
                        <td style={{ ...td, color: '#64748b' }}>{row.teamName}</td>
                        {allTypes.map((t) => (
                          <td key={t} style={{ ...td, textAlign: 'right' }}>
                            {row.counts[t] != null ? (DAY_BASED_TYPES.includes(t) ? `${row.counts[t]}일` : `${row.counts[t].toFixed(1)}h`) : '—'}
                          </td>
                        ))}
                        {hasHolidayOt && (
                          <td style={{ ...td, textAlign: 'right', color: '#7c3aed', fontWeight: 600 }}>
                            {row.counts['HOLIDAY_OT'] ? `${row.counts['HOLIDAY_OT'].toFixed(1)}h` : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 상세 목록 */}
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>상세 내역 <span style={{ fontWeight: 400, color: '#94a3b8' }}>({filtered.length}건)</span></h3>
            {filtered.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>해당 조건의 근태 신청이 없습니다.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>구성원</th>
                      <th style={th}>팀</th>
                      <th style={th}>유형</th>
                      <th style={th}>신청일</th>
                      <th style={th}>기준일</th>
                      <th style={th}>시간</th>
                      <th style={{ ...th, textAlign: 'right' }}>시간/일수</th>
                      <th style={th}>상태</th>
                      <th style={th}>결재선</th>
                      <th style={th}>사유</th>
                      {isExec && <th style={th}>관리</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((it) => (
                      <tr key={it.id}>
                        <td style={td}>{it.userName}</td>
                        <td style={{ ...td, color: '#64748b' }}>{it.teamName}</td>
                        <td style={td}>
                          <span style={{ background: '#f1f5f9', borderRadius: 4, padding: '2px 6px', fontSize: 12 }}>
                            {TYPE_LABELS[it.type] || it.type}
                          </span>
                        </td>
                        <td style={td}>
                          {it.endDate ? `${fmt(it.date)} ~ ${fmt(it.endDate)}` : fmt(it.date)}
                        </td>
                        <td style={td}>
                          {it.baseDateDiffers ? (
                            <span title="OT 시간이 자정 이후(새벽)라 전날 근무의 연속으로 보고 기준일을 전날로 표시" style={{ fontWeight: 700, color: '#7c3aed' }}>
                              {fmt(it.baseDate || it.date)}
                              <span style={{ marginLeft: 4, fontSize: 10, fontWeight: 700, color: '#7c3aed', background: '#f3e8ff', borderRadius: 8, padding: '1px 5px', whiteSpace: 'nowrap' }}>전날</span>
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>{fmt(it.baseDate || it.date)}</span>
                          )}
                        </td>
                        <td style={{ ...td, color: '#64748b' }}>
                          {it.startAt && it.endAt ? `${fmtTime(it.startAt)} ~ ${fmtTime(it.endAt)}${it.baseDateDiffers ? ' (익일)' : ''}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {it.type === 'OT' && String(it.status).toUpperCase() === 'REJECTED' ? (
                            <div>
                              <div style={{ textDecoration: 'line-through', color: '#94a3b8' }}>{it.hours != null ? `${it.hours.toFixed(1)}h` : '—'}</div>
                              <div style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }}>반려 · 제외</div>
                            </div>
                          ) : it.type === 'HOLIDAY_WORK' && it.hours != null ? (
                            <div>
                              <div>{it.hours.toFixed(1)}h</div>
                              <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                대체 {(it.compHours ?? Math.min(it.hours, 8)).toFixed(0)}h · <span style={{ color: '#7c3aed' }}>잔여OT {(it.otHours ?? Math.max(0, it.hours - 8)).toFixed(1)}h</span>
                              </div>
                            </div>
                          ) : it.hours != null ? (
                            <div>
                              {it.hours.toFixed(1)}h
                              {isDupOt(it) && <div style={{ fontSize: 11, color: '#b45309', whiteSpace: 'nowrap' }}>휴일근무일 OT · 확인</div>}
                            </div>
                          ) : it.days != null ? `${it.days}일` : '—'}
                        </td>
                        <td style={td}>
                          <span style={{ color: STATUS_COLORS[it.status] || '#374151', fontWeight: 600, fontSize: 12 }}>
                            {STATUS_LABELS[it.status] || it.status}
                          </span>
                        </td>
                        <td style={{ ...td, fontSize: 12 }}>
                          {it.approvalSteps && it.approvalSteps.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              {it.approvalSteps.map((step, idx) => (
                                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ color: '#475569' }}>{step.stepNo}.</span>
                                  <span style={{ fontWeight: 500 }}>{step.approverName}</span>
                                  <span style={{
                                    color: step.status === 'APPROVED' ? '#22c55e' : step.status === 'REJECTED' ? '#ef4444' : '#f59e0b',
                                    fontSize: 11,
                                  }}>
                                    ({STATUS_LABELS[step.status] || step.status})
                                  </span>
                                  {step.decidedAt && (
                                    <span style={{ color: '#94a3b8', fontSize: 11 }}>
                                      {fmtDateTime(step.decidedAt)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : it.status === 'PENDING' && it.currentApproverName ? (
                            <span style={{ color: '#f59e0b' }}>{it.currentApproverName} (대기)</span>
                          ) : '—'}
                        </td>
                        <td style={{ ...td, color: '#64748b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.reason || '—'}
                        </td>
                        {isExec && (
                          <td style={td}>
                            <button
                              onClick={() => handleDelete(it.id, it.userName)}
                              style={{ padding: '2px 8px', fontSize: 11, background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer' }}
                            >
                              삭제
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
