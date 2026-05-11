import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

type DispatchStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

type LogisticsItem = {
  id: string;
  carName: string;
  requesterName: string;
  approverName: string;
  coRiders?: string | null;
  startAt: string;
  endAt: string;
  destination: string;
  purpose: string;
  cargoDetails?: string | null;
  status: DispatchStatus;
  createdAt: string;
};

type Car = { id: string; name: string; type?: string | null };

const statusLabel: Record<DispatchStatus, string> = { PENDING: '대기중', APPROVED: '승인', REJECTED: '반려', CANCELLED: '취소' };
const statusStyle: Record<DispatchStatus, React.CSSProperties> = {
  PENDING:   { background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a' },
  APPROVED:  { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' },
  REJECTED:  { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' },
  CANCELLED: { background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' },
};
const badge = (s: DispatchStatus): React.CSSProperties => ({
  ...statusStyle[s], borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
});

const input: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13, boxSizing: 'border-box', width: '100%' };
const primaryBtn: React.CSSProperties = { background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 700 };

function fmt(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CarDispatchLogistics() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<LogisticsItem[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 필터
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // 신청 폼
  const [showForm, setShowForm] = useState(false);
  const [carId, setCarId] = useState('');
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const [cargoDetails, setCargoDetails] = useState('');
  const [coRiders, setCoRiders] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { void load(); void loadCars(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterFrom) params.set('from', new Date(filterFrom + 'T00:00:00+09:00').toISOString());
      if (filterTo) params.set('to', new Date(filterTo + 'T23:59:59+09:00').toISOString());
      const res = await apiJson<{ items: LogisticsItem[] }>(`/api/car-dispatch/logistics?${params.toString()}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function loadCars() {
    try {
      const res = await apiJson<{ items: Car[] }>('/api/cars');
      setCars(res.items || []);
      if (res.items?.length) setCarId(res.items[0].id);
    } catch {}
  }

  async function handleSubmit() {
    if (!carId || !destination || !purpose || !startAt || !endAt) {
      setError('차량, 목적지, 목적, 출발/도착 일시를 모두 입력해주세요.');
      return;
    }
    if (new Date(endAt) <= new Date(startAt)) {
      setError('도착 일시는 출발 일시보다 이후여야 합니다.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiJson('/api/car-dispatch', {
        method: 'POST',
        body: JSON.stringify({
          carId, requesterId: userId,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          destination, purpose, cargoDetails: cargoDetails || undefined,
          coRiders: coRiders || undefined,
          dispatchType: 'LOGISTICS',
        }),
      });
      setShowForm(false);
      setDestination(''); setPurpose(''); setCargoDetails(''); setCoRiders(''); setStartAt(''); setEndAt('');
      await load();
    } catch (e: any) {
      setError(e?.message || '신청 실패');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>물류 배차 신청</h2>
        <button style={primaryBtn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? '닫기' : '+ 물류 신청'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#991b1b', display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* 신청 폼 */}
      {showForm && (
        <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 12, padding: 20, display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>새 물류 배차 신청</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'grid', gap: 5 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>차량 *</label>
              <select value={carId} onChange={(e) => setCarId(e.target.value)} style={input}>
                <option value="">차량 선택</option>
                {cars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.type ? ` (${c.type})` : ''}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gap: 5 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>목적지 *</label>
              <input value={destination} onChange={(e) => setDestination(e.target.value)} style={input} placeholder="배송지 주소" />
            </div>
            <div style={{ display: 'grid', gap: 5 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>출발 일시 *</label>
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={input} />
            </div>
            <div style={{ display: 'grid', gap: 5 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>도착 예정 일시 *</label>
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={input} />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>물류 목적 *</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} style={input} placeholder="예: 고객사 납품, 원자재 운반" />
          </div>
          <div style={{ display: 'grid', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>화물 내용</label>
            <input value={cargoDetails} onChange={(e) => setCargoDetails(e.target.value)} style={input} placeholder="예: 금형 2개, 약 150kg" />
          </div>
          <div style={{ display: 'grid', gap: 5 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>동승자</label>
            <input value={coRiders} onChange={(e) => setCoRiders(e.target.value)} style={input} placeholder="동승자 이름 (선택)" />
          </div>
          <div style={{ fontSize: 12, color: '#64748b', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 6, padding: '6px 10px' }}>
            📋 1차 결재자: 홍규현 (배차 담당 — 자동 지정)
          </div>
          <div>
            <button style={primaryBtn} onClick={handleSubmit} disabled={submitting}>
              {submitting ? '신청중…' : '물류 배차 신청'}
            </button>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>상태</label>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...input, width: 'auto' }}>
            <option value="">전체</option>
            <option value="PENDING">대기중</option>
            <option value="APPROVED">승인</option>
            <option value="REJECTED">반려</option>
            <option value="CANCELLED">취소</option>
          </select>
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>출발일 시작</label>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={{ ...input, width: 'auto' }} />
        </div>
        <div style={{ display: 'grid', gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>출발일 종료</label>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={{ ...input, width: 'auto' }} />
        </div>
        <button onClick={load} style={{ ...primaryBtn, alignSelf: 'flex-end' }}>조회</button>
        <button onClick={() => { setFilterStatus(''); setFilterFrom(''); setFilterTo(''); setTimeout(load, 0); }}
          style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, alignSelf: 'flex-end' }}>
          초기화
        </button>
      </div>

      {/* 리스트 */}
      {loading ? <div style={{ color: '#64748b', padding: 20 }}>불러오는 중…</div> : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                {['상태', '차량', '신청자', '출발 일시', '도착 예정', '목적지', '목적', '화물 내용', '동승자', '결재자', '신청일'].map((h) => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={11} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>물류 배차 신청 내역이 없습니다.</td></tr>
              ) : items.map((it, i) => (
                <tr key={it.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '9px 12px' }}><span style={badge(it.status as DispatchStatus)}>{statusLabel[it.status as DispatchStatus] || it.status}</span></td>
                  <td style={{ padding: '9px 12px', fontWeight: 600 }}>{it.carName}</td>
                  <td style={{ padding: '9px 12px' }}>{it.requesterName}</td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{fmt(it.startAt)}</td>
                  <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>{fmt(it.endAt)}</td>
                  <td style={{ padding: '9px 12px' }}>{it.destination}</td>
                  <td style={{ padding: '9px 12px' }}>{it.purpose}</td>
                  <td style={{ padding: '9px 12px', color: '#475569' }}>{it.cargoDetails || '-'}</td>
                  <td style={{ padding: '9px 12px', color: '#475569' }}>{it.coRiders || '-'}</td>
                  <td style={{ padding: '9px 12px' }}>{it.approverName}</td>
                  <td style={{ padding: '9px 12px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmt(it.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.length > 0 && (
            <div style={{ padding: '8px 14px', color: '#64748b', fontSize: 12, borderTop: '1px solid #f1f5f9' }}>총 {items.length}건</div>
          )}
        </div>
      )}
    </div>
  );
}
