import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

const TYPE_LABELS: Record<string, string> = {
  OT: '초과근무(OT)',
  VACATION: '휴가',
  EARLY_LEAVE: '조기퇴근',
  FLEXIBLE: '유연근무',
  HOLIDAY_WORK: '휴일근무',
  HOLIDAY_REST: '대체휴무',
};

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

type RecordItem = {
  id: string;
  userId: string;
  userName: string;
  teamName: string;
  type: string;
  date: string;
  startAt: string | null;
  endAt: string | null;
  hours: number | null;
  days: number | null;
  status: string;
  reason: string | null;
  currentApproverName?: string;
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
    if (!isExec) return;
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, isExec]);

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

  // Summary: per-user totals
  const summary = useMemo(() => {
    const map = new Map<string, { userName: string; teamName: string; counts: Record<string, number> }>();
    for (const it of filtered) {
      if (!map.has(it.userId)) map.set(it.userId, { userName: it.userName, teamName: it.teamName, counts: {} });
      const entry = map.get(it.userId)!;
      const key = it.type;
      const val = it.hours != null ? it.hours : (it.days != null ? it.days : 1);
      entry.counts[key] = (entry.counts[key] || 0) + val;
    }
    return Array.from(map.entries()).map(([uid, v]) => ({ userId: uid, ...v }));
  }, [filtered]);

  const allTypes = useMemo(() => {
    const s = new Set(filtered.map((it) => it.type));
    return Object.keys(TYPE_LABELS).filter((t) => s.has(t));
  }, [filtered]);

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '';
  const fmtTime = (d: string | null) => d ? new Date(d).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';

  const th: React.CSSProperties = { borderBottom: '2px solid #e2e8f0', padding: '8px 10px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#475569', background: '#f8fafc', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { borderBottom: '1px solid #f1f5f9', padding: '7px 10px', fontSize: 13, verticalAlign: 'middle' };

  if (roleLoading) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>권한 확인 중…</div>;
  }

  if (!isExec) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#ef4444' }}>
        임원 이상(임원/대표이사)만 근태 리포트를 조회할 수 있습니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>근태 월 리포트</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); }} style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }} />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}>
            <option value="">전체 유형</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)} style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}>
            <option value="">전체 구성원</option>
            {users.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
          </select>
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
                            {t === 'VACATION' || t === 'HOLIDAY_REST' ? '(일)' : '(시간)'}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map((row) => (
                      <tr key={row.userId}>
                        <td style={td}>{row.userName}</td>
                        <td style={{ ...td, color: '#64748b' }}>{row.teamName}</td>
                        {allTypes.map((t) => (
                          <td key={t} style={{ ...td, textAlign: 'right' }}>
                            {row.counts[t] != null ? (t === 'VACATION' || t === 'HOLIDAY_REST' ? `${row.counts[t]}일` : `${row.counts[t].toFixed(1)}h`) : '—'}
                          </td>
                        ))}
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
                      <th style={th}>날짜</th>
                      <th style={th}>시간</th>
                      <th style={{ ...th, textAlign: 'right' }}>시간/일수</th>
                      <th style={th}>상태</th>
                      <th style={th}>결재자</th>
                      <th style={th}>사유</th>
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
                        <td style={td}>{fmt(it.date)}</td>
                        <td style={{ ...td, color: '#64748b' }}>
                          {it.startAt && it.endAt ? `${fmtTime(it.startAt)} ~ ${fmtTime(it.endAt)}` : '—'}
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {it.hours != null ? `${it.hours.toFixed(1)}h` : it.days != null ? `${it.days}일` : '—'}
                        </td>
                        <td style={td}>
                          <span style={{ color: STATUS_COLORS[it.status] || '#374151', fontWeight: 600, fontSize: 12 }}>
                            {STATUS_LABELS[it.status] || it.status}
                          </span>
                        </td>
                        <td style={{ ...td, color: it.status === 'PENDING' ? '#f59e0b' : '#64748b' }}>
                          {it.status === 'PENDING' && it.currentApproverName ? it.currentApproverName : '—'}
                        </td>
                        <td style={{ ...td, color: '#64748b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.reason || '—'}
                        </td>
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
