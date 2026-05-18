import { useEffect, useState } from 'react';
import { ApproverIdPicker } from '../components/MemberSearchPicker';
import { apiJson } from '../lib/api';

type TripStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type Trip = {
  id: string;
  destination: string;
  purpose: string;
  departureAt: string;
  returnAt: string;
  transportation?: string | null;
  accommodation: boolean;
  notes?: string | null;
  status: TripStatus;
  requester: { id: string; name: string };
  approver: { id: string; name: string };
  createdAt: string;
};

type Member = { id: string; name: string; role: string };
type Car = { id: string; name: string; type?: string | null };

const statusLabel: Record<TripStatus, string> = { PENDING: '대기중', APPROVED: '승인', REJECTED: '반려' };
const statusColor: Record<TripStatus, React.CSSProperties> = {
  PENDING: { background: '#fef9c3', color: '#92400e', border: '1px solid #fde68a', borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 },
  APPROVED: { background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 },
  REJECTED: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 },
};

const input: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 14, boxSizing: 'border-box' };
const primaryBtn: React.CSSProperties = { background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 700 };
const ghostBtn: React.CSSProperties = { background: '#f1f5f9', color: '#334155', border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 14 };

function toLocalDatetimeValue(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtRange(dep: string, ret: string) {
  const d = new Date(dep);
  const r = new Date(ret);
  const fmt = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  return `${fmt(d)} ~ ${fmt(r)}`;
}

export function BusinessTripRequest() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [trips, setTrips] = useState<Trip[]>([]);
  const [approverTrips, setApproverTrips] = useState<Trip[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [carId, setCarId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'mine' | 'approve'>('mine');

  // Form
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const [departureAt, setDepartureAt] = useState('');
  const [returnAt, setReturnAt] = useState('');
  const [transportation, setTransportation] = useState('대중교통');
  const [accommodation, setAccommodation] = useState(false);
  const [notes, setNotes] = useState('');
  const [approverIds, setApproverIds] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (userId) { void load(); void loadMembers(); void loadCars(); }
  }, [userId]);

  async function load() {
    setLoading(true);
    try {
      const [mine, toApprove] = await Promise.all([
        apiJson<{ items: Trip[] }>(`/api/business-trips?requesterId=${userId}`),
        apiJson<{ items: Trip[] }>(`/api/business-trips?approverId=${userId}`),
      ]);
      setTrips(mine.items || []);
      setApproverTrips(toApprove.items || []);
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
    } catch {}
  }

  async function loadMembers() {
    try {
      const res = await apiJson<{ items: Member[] }>('/api/users?limit=200');
      const all = (res.items || []).filter((m) => m.id !== userId);
      setMembers(all);
    } catch {}
  }

  async function handleSubmit() {
    const cleanedApprovers = approverIds.map((id) => id.trim()).filter(Boolean);
    if (!destination.trim() || !purpose.trim() || !departureAt || !returnAt) {
      setError('목적지, 출장 목적, 출발/귀임 일시를 입력해주세요.');
      return;
    }
    if (cleanedApprovers.length === 0) {
      setError('결재선에 최소 한 명의 결재자를 선택해주세요.');
      return;
    }
    if (transportation === '회사 차량' && !carId) {
      setError('회사 차량 이용 시 차량을 선택해주세요.');
      return;
    }
    if (new Date(returnAt) <= new Date(departureAt)) {
      setError('귀임 일시는 출발 일시보다 이후여야 합니다.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiJson('/api/business-trips', {
        method: 'POST',
        body: JSON.stringify({ requesterId: userId, approverIds: cleanedApprovers, destination, purpose, departureAt, returnAt, transportation, carId: transportation === '회사 차량' ? carId : undefined, accommodation, notes }),
      });
      setDestination(''); setPurpose(''); setDepartureAt(''); setReturnAt('');
      setTransportation('대중교통'); setAccommodation(false); setNotes('');
      setCarId('');
      setApproverIds(['']);
      await load();
    } catch (e: any) {
      setError(e?.message || '신청 실패');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await apiJson(`/api/business-trips/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      await load();
    } catch (e: any) {
      setError(e?.message || '처리 실패');
    }
  }

  const tabBtn = (t: 'mine' | 'approve', label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{ padding: '7px 18px', border: 'none', borderRadius: 8, fontWeight: tab === t ? 700 : 400, background: tab === t ? '#0F3D73' : '#f1f5f9', color: tab === t ? '#fff' : '#334155', cursor: 'pointer', fontSize: 14 }}
    >{label}</button>
  );

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 860, margin: '0 auto', padding: 16 }}>
      <h2 style={{ margin: 0 }}>출장 신청</h2>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#991b1b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {error}
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* 신청 폼 */}
      <div style={{ background: '#fff', border: '1px solid #CBD5E1', borderRadius: 12, padding: 20, display: 'grid', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>새 출장 신청</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>목적지 *</label>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} style={input} placeholder="예: 서울 본사, 부산 협력사" />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>교통편</label>
            <select value={transportation} onChange={(e) => { setTransportation(e.target.value); setCarId(''); }} style={input}>
              <option>대중교통</option>
              <option>자가용</option>
              <option>회사 차량</option>
              <option>항공</option>
              <option>렌터카</option>
              <option>기타</option>
            </select>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>출발 일시 *</label>
            <input type="datetime-local" value={departureAt} onChange={(e) => setDepartureAt(e.target.value)} style={input} />
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>귀임 일시 *</label>
            <input type="datetime-local" value={returnAt} onChange={(e) => setReturnAt(e.target.value)} style={input} />
          </div>
        </div>
        {transportation === '회사 차량' && (
          <div style={{ display: 'grid', gap: 6, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '10px 12px' }}>
            <label style={{ fontSize: 13, fontWeight: 700, color: '#0369a1' }}>차량 선택 * <span style={{ fontWeight: 400, fontSize: 12 }}>(해당 시간 자동 선점됩니다)</span></label>
            <select value={carId} onChange={(e) => setCarId(e.target.value)} style={input}>
              <option value="">차량 선택</option>
              {cars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.type ? ` (${c.type})` : ''}</option>)}
            </select>
            {cars.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>등록된 차량이 없습니다. 관리자에게 문의하세요.</div>}
          </div>
        )}
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>출장 목적 *</label>
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} style={{ ...input, minHeight: 72, resize: 'vertical' }} placeholder="출장 목적을 간략히 기술해주세요" />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>결재선 *</span>
          <div style={{ display: 'grid', gap: 6 }}>
            {approverIds.map((aid, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ minWidth: 52, fontSize: 12, color: '#475569', fontWeight: 700 }}>{idx + 1}단계</span>
                <ApproverIdPicker
                  value={aid}
                  onChange={(id) => setApproverIds((prev) => prev.map((p, i) => i === idx ? id : p))}
                  members={members}
                  placeholder="이름 검색"
                />
                <button type="button" onClick={() => setApproverIds((prev) => prev.filter((_, i) => i !== idx))} disabled={approverIds.length <= 1}
                  style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', cursor: approverIds.length <= 1 ? 'not-allowed' : 'pointer', color: approverIds.length <= 1 ? '#cbd5e1' : '#475569' }}
                >−</button>
              </div>
            ))}
            <button type="button" onClick={() => setApproverIds((prev) => [...prev, ''])}
              style={{ justifySelf: 'start', padding: '4px 10px', fontSize: 12, border: '1px dashed #94a3b8', borderRadius: 6, background: '#f8fafc', cursor: 'pointer', color: '#475569' }}
            >+ 결재자 추가</button>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>숙박 여부</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={accommodation} onChange={(e) => setAccommodation(e.target.checked)} />
            숙박 필요
          </label>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>비고</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} style={input} placeholder="추가 사항 (선택)" />
        </div>
        <div>
          <button style={primaryBtn} onClick={handleSubmit} disabled={submitting}>
            {submitting ? '신청중…' : '출장 신청'}
          </button>
        </div>
      </div>

      {/* 탭: 내 신청 / 결재 대기 */}
      <div style={{ display: 'flex', gap: 8 }}>
        {tabBtn('mine', `내 신청 (${trips.length})`)}
        {tabBtn('approve', `결재 대기 (${approverTrips.filter(t => t.status === 'PENDING').length})`)}
      </div>

      {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {(tab === 'mine' ? trips : approverTrips).map((t) => (
            <div key={t.id} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{t.destination}</span>
                <span style={statusColor[t.status as TripStatus] || statusColor.PENDING}>{statusLabel[t.status as TripStatus] || t.status}</span>
                {t.accommodation && <span style={{ fontSize: 12, background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: 6, padding: '2px 7px' }}>숙박</span>}
              </div>
              <div style={{ fontSize: 13, color: '#475569' }}>
                <span>📍 {t.destination}</span>
                <span style={{ marginLeft: 12 }}>🚌 {t.transportation || '-'}</span>
                <span style={{ marginLeft: 12 }}>📅 {fmtRange(t.departureAt, t.returnAt)}</span>
              </div>
              <div style={{ fontSize: 13, color: '#334155' }}>{t.purpose}</div>
              <div style={{ fontSize: 12, color: '#64748b', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>신청자: {t.requester.name}</span>
                <span>결재선: {Array.isArray((t as any).approvalLine) && (t as any).approvalLine.length > 1
                  ? (t as any).approvalLine.map((_: any, i: number) => `${i + 1}단계`).join(' → ')
                  : t.approver.name}</span>
                {t.notes && <span>비고: {t.notes}</span>}
              </div>
              {tab === 'approve' && t.status === 'PENDING' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={{ ...primaryBtn, background: '#059669' }} onClick={() => handleStatusChange(t.id, 'APPROVED')}>승인</button>
                  <button style={{ ...ghostBtn, color: '#DC2626' }} onClick={() => handleStatusChange(t.id, 'REJECTED')}>반려</button>
                </div>
              )}
            </div>
          ))}
          {(tab === 'mine' ? trips : approverTrips).length === 0 && (
            <div style={{ color: '#94a3b8', fontSize: 14 }}>
              {tab === 'mine' ? '신청한 출장이 없습니다.' : '결재 대기 중인 출장 신청이 없습니다.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
