import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type AccessRecord = {
  id: number;
  source: string;
  employee_id: string;
  employee_name: string;
  access_time: string;
  access_date: string;
  location: string;
  gate: string;
  direction: string;
  access_type: string;
};

type VerificationStatus = 'OK' | 'WARN' | 'FAIL' | 'NO_DATA';

type OtItem = {
  id: string;
  userId: string;
  userName: string;
  employeeNo: string | null;
  teamName: string;
  date: string;
  startAt: string;
  endAt: string;
  hours: number;
  reason: string | null;
  status: string;
  verified: boolean;
  verificationStatus: VerificationStatus;
  beforeRecord: AccessRecord | null;
  afterRecord: AccessRecord | null;
  allRecords: AccessRecord[];
  verificationNote: string;
};

type Summary = {
  total: number;
  verified: number;
  warn: number;
  fail: number;
  noData: number;
  totalHours: number;
  verifiedHours: number;
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

export function OtVerification() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<OtItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterUser, setFilterUser] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'OK' | 'WARN' | 'FAIL' | 'NO_DATA'>('all');
  const [selectedItem, setSelectedItem] = useState<OtItem | null>(null);

  const [myRole, setMyRole] = useState('');
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setRoleLoading(false);
      return;
    }
    apiJson<{ role: string }>(`/api/users/me?userId=${encodeURIComponent(userId)}`)
      .then((me) => setMyRole(String(me?.role || '').toUpperCase()))
      .catch(() => setMyRole(''))
      .finally(() => setRoleLoading(false));
  }, [userId]);

  const isExec = myRole === 'CEO' || myRole === 'EXEC';

  useEffect(() => {
    if (!isExec) return;
    void loadData();
  }, [month, isExec]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month });
      const res = await apiJson<{ items: OtItem[]; summary: Summary }>(
        `/api/ot-verification?${params}`,
      );
      setItems(res.items || []);
      setSummary(res.summary || null);
    } catch (e: any) {
      setError(e?.message || 'OT 검증 데이터를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  const users = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((it) => map.set(it.userId, it.userName || it.userId));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const dates = useMemo(() => {
    const set = new Set<string>();
    items.forEach((it) => set.add(it.date));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filterUser && it.userId !== filterUser) return false;
      if (filterDate && it.date !== filterDate) return false;
      if (filterStatus !== 'all' && it.verificationStatus !== filterStatus) return false;
      return true;
    });
  }, [items, filterUser, filterDate, filterStatus]);

  const fmtDate = (d: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  };

  const fmtTime = (d: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  };

  const fmtDateTime = (d: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  };

  const th: React.CSSProperties = {
    borderBottom: '2px solid #e2e8f0',
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 700,
    color: '#475569',
    background: '#f8fafc',
    whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    borderBottom: '1px solid #f1f5f9',
    padding: '7px 10px',
    fontSize: 13,
    verticalAlign: 'middle',
  };

  if (roleLoading) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>권한 확인 중…</div>;
  }

  if (!isExec) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#ef4444' }}>
        임원 이상(임원/대표이사)만 OT 검증 페이지를 조회할 수 있습니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>OT 검증 (입출입 기록 대조)</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
          />
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
          >
            <option value="">전체 구성원</option>
            {users.map(([uid, name]) => (
              <option key={uid} value={uid}>{name}</option>
            ))}
          </select>
          <select
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
          >
            <option value="">전체 날짜</option>
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
          >
            <option value="all">전체 상태</option>
            <option value="OK">✅ 확인됨</option>
            <option value="WARN">⚠️ 경고</option>
            <option value="FAIL">❌ 미확인</option>
            <option value="NO_DATA">➖ 데이터없음</option>
          </select>
          <button
            onClick={() => void loadData()}
            style={{
              padding: '4px 12px',
              background: '#0F3D73',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            조회
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}

      {summary && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            padding: 12,
            background: '#f8fafc',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: '#64748b' }}>전체 OT</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{summary.total}건</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#22c55e' }}>✅ 확인됨</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{summary.verified}건</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#f59e0b' }}>⚠️ 경고</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>{summary.warn}건</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#ef4444' }}>❌ 미확인</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{summary.fail}건</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>➖ 데이터없음</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#94a3b8' }}>{summary.noData}건</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b' }}>전체 시간</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{summary.totalHours.toFixed(1)}h</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#22c55e' }}>확인된 시간</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{summary.verifiedHours.toFixed(1)}h</div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>로딩 중…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>검증</th>
                <th style={th}>구성원</th>
                <th style={th}>사번</th>
                <th style={th}>팀</th>
                <th style={th}>날짜</th>
                <th style={th}>OT 시간</th>
                <th style={{ ...th, textAlign: 'right' }}>시간</th>
                <th style={th}>결재상태</th>
                <th style={th}>입출입 기록</th>
                <th style={th}>비고</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 24 }}>
                    해당 조건의 OT 신청이 없습니다.
                  </td>
                </tr>
              ) : (
                filtered.map((it) => {
                  const rowBg = it.verificationStatus === 'OK' ? undefined
                    : it.verificationStatus === 'WARN' ? '#fef9c3'
                    : it.verificationStatus === 'FAIL' ? '#fee2e2'
                    : '#f1f5f9';
                  const statusIcon = it.verificationStatus === 'OK' ? '✅'
                    : it.verificationStatus === 'WARN' ? '⚠️'
                    : it.verificationStatus === 'FAIL' ? '❌'
                    : '➖';
                  const statusColor = it.verificationStatus === 'OK' ? '#22c55e'
                    : it.verificationStatus === 'WARN' ? '#f59e0b'
                    : it.verificationStatus === 'FAIL' ? '#ef4444'
                    : '#94a3b8';
                  return (
                  <tr
                    key={it.id}
                    style={{ cursor: 'pointer', background: rowBg }}
                    onClick={() => setSelectedItem(it)}
                  >
                    <td style={td}>
                      <span style={{ color: statusColor, fontWeight: 700 }}>{statusIcon}</span>
                    </td>
                    <td style={td}>{it.userName}</td>
                    <td style={{ ...td, color: '#64748b', fontSize: 12 }}>{it.employeeNo || '-'}</td>
                    <td style={{ ...td, color: '#64748b' }}>{it.teamName}</td>
                    <td style={td}>{fmtDate(it.date)}</td>
                    <td style={td}>
                      {fmtTime(it.startAt)} ~ {fmtTime(it.endAt)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {it.hours.toFixed(1)}h
                    </td>
                    <td style={td}>
                      <span style={{ color: STATUS_COLORS[it.status] || '#374151', fontWeight: 600, fontSize: 12 }}>
                        {STATUS_LABELS[it.status] || it.status}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 11 }}>
                      {it.beforeRecord && (
                        <div style={{ color: '#22c55e' }}>
                          IN: {fmtDateTime(it.beforeRecord.access_time)}
                        </div>
                      )}
                      {it.afterRecord && (
                        <div style={{ color: '#3b82f6' }}>
                          OUT: {fmtDateTime(it.afterRecord.access_time)}
                        </div>
                      )}
                      {!it.beforeRecord && !it.afterRecord && (
                        <span style={{ color: '#94a3b8' }}>-</span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#64748b', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.verificationNote || '-'}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedItem && (
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
          onClick={() => setSelectedItem(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 20,
              minWidth: 320,
              maxWidth: 600,
              maxHeight: '80vh',
              overflow: 'auto',
              boxShadow: '0 12px 32px rgba(15,23,42,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>OT 상세 / 입출입 기록</h3>
              <button
                onClick={() => setSelectedItem(null)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gap: 8, fontSize: 13, marginBottom: 16 }}>
              <div><strong>구성원:</strong> {selectedItem.userName} ({selectedItem.teamName})</div>
              <div><strong>사번:</strong> {selectedItem.employeeNo || '미등록'}</div>
              <div><strong>날짜:</strong> {selectedItem.date}</div>
              <div><strong>OT 시간:</strong> {fmtTime(selectedItem.startAt)} ~ {fmtTime(selectedItem.endAt)} ({selectedItem.hours.toFixed(1)}h)</div>
              <div><strong>사유:</strong> {selectedItem.reason || '-'}</div>
              <div><strong>결재상태:</strong> {STATUS_LABELS[selectedItem.status] || selectedItem.status}</div>
              <div>
                <strong>검증결과:</strong>{' '}
                {selectedItem.verificationStatus === 'OK' ? (
                  <span style={{ color: '#22c55e' }}>✅ 확인됨</span>
                ) : selectedItem.verificationStatus === 'WARN' ? (
                  <span style={{ color: '#f59e0b' }}>⚠️ {selectedItem.verificationNote}</span>
                ) : selectedItem.verificationStatus === 'FAIL' ? (
                  <span style={{ color: '#ef4444' }}>❌ {selectedItem.verificationNote}</span>
                ) : (
                  <span style={{ color: '#94a3b8' }}>➖ {selectedItem.verificationNote}</span>
                )}
              </div>
            </div>

            <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>입출입 기록 ({selectedItem.allRecords.length}건)</h4>
            {selectedItem.allRecords.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>입출입 기록이 없습니다.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, fontSize: 11 }}>시간</th>
                      <th style={{ ...th, fontSize: 11 }}>위치</th>
                      <th style={{ ...th, fontSize: 11 }}>출처</th>
                      <th style={{ ...th, fontSize: 11 }}>게이트</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedItem.allRecords.map((r, idx) => {
                      const isBefore = selectedItem.beforeRecord?.id === r.id;
                      const isAfter = selectedItem.afterRecord?.id === r.id;
                      return (
                        <tr
                          key={idx}
                          style={{
                            background: isBefore ? '#dcfce7' : isAfter ? '#dbeafe' : undefined,
                          }}
                        >
                          <td style={td}>
                            {fmtDateTime(r.access_time)}
                            {isBefore && <span style={{ marginLeft: 4, color: '#22c55e' }}>(시작전)</span>}
                            {isAfter && <span style={{ marginLeft: 4, color: '#3b82f6' }}>(종료후)</span>}
                          </td>
                          <td style={td}>{r.location}</td>
                          <td style={{ ...td, fontSize: 11, color: '#64748b' }}>{r.source}</td>
                          <td style={{ ...td, fontSize: 11, color: '#64748b' }}>{r.gate}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
