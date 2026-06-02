import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type AccessRecord = {
  source: string;
  eventAt: string;
  employeeNo: string;
  personName: string;
  location: string;
  direction: string;
};

type OtRequest = {
  id: string;
  userId: string;
  userName: string;
  employeeNo: string;
  startAt: string;
  endAt: string;
  reason: string;
};

type Summary = {
  ktCount: number;
  secomCount: number;
  capsCount: number;
  totalAccessRecords: number;
  otCount: number;
};

type ReportData = {
  date: string;
  summary: Summary;
  accessRecords: AccessRecord[];
  otRequests: OtRequest[];
};

export function AccessRecordReport() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterName, setFilterName] = useState('');
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
    void loadData();
  }, [date, isExec]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date, actorId: userId });
      const res = await apiJson<ReportData>(`/api/ot-verification/daily-report?${params}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message || '데이터를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  const filteredRecords = useMemo(() => {
    if (!data?.accessRecords) return [];
    if (!filterName.trim()) return data.accessRecords;
    const q = filterName.trim().toLowerCase();
    return data.accessRecords.filter(
      (r) => r.personName.toLowerCase().includes(q) || r.employeeNo.includes(q)
    );
  }, [data?.accessRecords, filterName]);

  const filteredOt = useMemo(() => {
    if (!data?.otRequests) return [];
    if (!filterName.trim()) return data.otRequests;
    const q = filterName.trim().toLowerCase();
    return data.otRequests.filter(
      (r) => r.userName.toLowerCase().includes(q) || r.employeeNo.includes(q)
    );
  }, [data?.otRequests, filterName]);

  const fmtTime = (d: string | null) =>
    d ? new Date(d).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';

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
        임원 이상만 입출입 기록 리포트를 조회할 수 있습니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>입출입 기록 일일 리포트</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
          />
          <input
            type="text"
            placeholder="이름/사번 검색"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, width: 140 }}
          />
          <button
            onClick={() => void loadData()}
            style={{ padding: '4px 12px', background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >
            조회
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}

      {data?.summary && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b' }}>KT (복지동/정문)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{data.summary.ktCount}건</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b' }}>SECOM (함평공장)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{data.summary.secomCount}건</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b' }}>CAPS (사무실)</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{data.summary.capsCount}건</div>
          </div>
          <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: 16 }}>
            <div style={{ fontSize: 11, color: '#3b82f6' }}>총 입출입</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#3b82f6' }}>{data.summary.totalAccessRecords}건</div>
          </div>
          <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: 16 }}>
            <div style={{ fontSize: 11, color: '#f59e0b' }}>OT 신청</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>{data.summary.otCount}건</div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>로딩 중…</div>
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          {/* OT 신청 목록 */}
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
              OT 신청 <span style={{ fontWeight: 400, color: '#94a3b8' }}>({filteredOt.length}건)</span>
            </h3>
            {filteredOt.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8 }}>
                해당 날짜의 OT 신청이 없습니다.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={th}>이름</th>
                      <th style={th}>사번</th>
                      <th style={th}>시작</th>
                      <th style={th}>종료</th>
                      <th style={th}>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOt.map((ot) => (
                      <tr key={ot.id}>
                        <td style={td}>{ot.userName}</td>
                        <td style={{ ...td, color: '#64748b' }}>{ot.employeeNo || '—'}</td>
                        <td style={td}>{fmtTime(ot.startAt)}</td>
                        <td style={td}>{fmtTime(ot.endAt)}</td>
                        <td style={{ ...td, color: '#64748b', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ot.reason || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 입출입 기록 */}
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
              입출입 기록 <span style={{ fontWeight: 400, color: '#94a3b8' }}>({filteredRecords.length}건)</span>
            </h3>
            {filteredRecords.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: 8 }}>
                해당 날짜의 입출입 기록이 없습니다.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 500, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ position: 'sticky', top: 0 }}>
                    <tr>
                      <th style={th}>시간</th>
                      <th style={th}>출처</th>
                      <th style={th}>이름</th>
                      <th style={th}>사번</th>
                      <th style={th}>장소</th>
                      <th style={th}>방향</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((rec, idx) => (
                      <tr key={idx}>
                        <td style={td}>{fmtTime(rec.eventAt)}</td>
                        <td style={td}>
                          <span style={{
                            background: rec.source === 'KT' ? '#dbeafe' : rec.source === 'SECOM' ? '#dcfce7' : '#fef3c7',
                            color: rec.source === 'KT' ? '#1e40af' : rec.source === 'SECOM' ? '#166534' : '#92400e',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                          }}>
                            {rec.source}
                          </span>
                        </td>
                        <td style={td}>{rec.personName}</td>
                        <td style={{ ...td, color: '#64748b' }}>{rec.employeeNo || '—'}</td>
                        <td style={{ ...td, color: '#64748b' }}>{rec.location}</td>
                        <td style={td}>{rec.direction || '—'}</td>
                      </tr>
                    ))}
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
