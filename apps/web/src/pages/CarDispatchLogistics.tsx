import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { ApproverIdPicker } from '../components/MemberSearchPicker';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

type CalItem = {
  id: string;
  loadingAt: string;
  unloadingAt: string;
  loadingPlace: string;
  unloadingPlace: string;
  vehicleType: string;
  requesterName: string;
  status: Status;
};

type ListItem = {
  id: string;
  requesterName: string;
  approverName: string;
  vehicleType: string;
  loadingPlace: string;
  loadingAt: string;
  loadingContact: string;
  loadingPhone: string;
  unloadingPlace: string;
  unloadingAt: string;
  unloadingContact: string;
  unloadingPhone: string;
  cargoDetails?: string | null;
  status: Status;
  createdAt: string;
};

const statusLabel: Record<Status, string> = { PENDING: '대기중', APPROVED: '승인', REJECTED: '반려', CANCELLED: '취소' };
const statusBg: Record<Status, string> = { PENDING: '#fef9c3', APPROVED: '#dcfce7', REJECTED: '#fee2e2', CANCELLED: '#f1f5f9' };
const statusTx: Record<Status, string> = { PENDING: '#92400e', APPROVED: '#166534', REJECTED: '#991b1b', CANCELLED: '#64748b' };

const inp: React.CSSProperties = { padding: '7px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13, width: '100%', boxSizing: 'border-box' as const };
const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' };
const secHead: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#0F3D73', background: '#eff6ff', padding: '4px 10px', borderRadius: 6, marginBottom: 8 };

function fmt(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function toIso(dt: string) { return dt ? new Date(dt).toISOString() : ''; }

function buildGrid(month: string, items: CalItem[]) {
  const [y, m] = month.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells: Array<{ day: number; items: CalItem[] } | null> = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const start = new Date(y, m - 1, d, 0, 0, 0);
    const end = new Date(y, m - 1, d, 23, 59, 59);
    cells.push({ day: d, items: items.filter((it) => new Date(it.loadingAt) >= start && new Date(it.loadingAt) <= end) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function CarDispatchLogistics() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  });
  const [calItems, setCalItems] = useState<CalItem[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ListItem | null>(null);

  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  const [members, setMembers] = useState<{ id: string; name: string; role?: string }[]>([]);
  const [approverIds, setApproverIds] = useState<string[]>(['']);
  const [finalApproverIds, setFinalApproverIds] = useState<string[]>([]); // 최종 담당자 any-of(기본 윤대룡·김부영, 변경 가능)

  const [vehicleType, setVehicleType] = useState('');
  const [loadingPlace, setLoadingPlace] = useState('');
  const [loadingAt, setLoadingAt] = useState('');
  const [loadingContact, setLoadingContact] = useState('');
  const [loadingPhone, setLoadingPhone] = useState('');
  const [unloadingPlace, setUnloadingPlace] = useState('');
  const [unloadingAt, setUnloadingAt] = useState('');
  const [unloadingContact, setUnloadingContact] = useState('');
  const [unloadingPhone, setUnloadingPhone] = useState('');
  const [cargoDetails, setCargoDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadCalendar(); }, [calMonth]);
  useEffect(() => { loadList(); loadMembers(); }, []);

  async function loadMembers() {
    try {
      const res = await apiJson<{ items: { id: string; name: string; role: string }[] }>('/api/users');
      const all = res.items || [];
      setMembers(all);
      // 결재선(앞단계)은 요청자가 관련부서 임원 → 대표이사 순으로 지정.
      // 최종 담당자는 기본 윤대룡·김부영으로 자동 세팅(요청자가 변경 가능).
      const defaults = ['윤대룡', '김부영'].map((n) => all.find((m) => m.name === n)?.id).filter((x): x is string => !!x);
      if (defaults.length) setFinalApproverIds(defaults);
    } catch {}
  }

  async function loadCalendar() {
    setCalLoading(true);
    try {
      const res = await apiJson<{ items: CalItem[] }>(`/api/logistics-dispatch/calendar?month=${calMonth}`);
      setCalItems(res.items || []);
    } catch {}
    finally { setCalLoading(false); }
  }

  async function loadList() {
    setListLoading(true);
    try {
      const p = new URLSearchParams();
      if (filterStatus) p.set('status', filterStatus);
      if (filterFrom) p.set('from', new Date(filterFrom + 'T00:00:00+09:00').toISOString());
      if (filterTo) p.set('to', new Date(filterTo + 'T23:59:59+09:00').toISOString());
      const res = await apiJson<{ items: ListItem[] }>(`/api/logistics-dispatch?${p}`);
      setListItems(res.items || []);
    } catch {}
    finally { setListLoading(false); }
  }

  function changeMonth(d: number) {
    const [y, m] = calMonth.split('-').map(Number);
    const nd = new Date(y, m - 1 + d, 1);
    setCalMonth(`${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}`);
  }

  async function clickCalItem(id: string) {
    try {
      const r = await apiJson<ListItem>(`/api/logistics-dispatch/${id}`);
      setSelectedEvent(r);
    } catch {}
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!vehicleType || !loadingPlace || !loadingAt || !loadingContact || !loadingPhone ||
        !unloadingPlace || !unloadingAt || !unloadingContact || !unloadingPhone) {
      setError('모든 필수 항목을 입력해 주세요.');
      return;
    }
    if (new Date(unloadingAt) <= new Date(loadingAt)) {
      setError('하차 일시는 상차 일시보다 이후여야 합니다.');
      return;
    }
    setSubmitting(true);
    try {
      const cleanedApprovers = approverIds.filter(Boolean);
      const cleanedFinals = finalApproverIds.filter(Boolean);
      await apiJson('/api/logistics-dispatch', {
        method: 'POST',
        body: JSON.stringify({
          requesterId: userId,
          approvalLine: cleanedApprovers,
          finalApprovers: cleanedFinals,
          vehicleType,
          loadingPlace, loadingAt: toIso(loadingAt), loadingContact, loadingPhone,
          unloadingPlace, unloadingAt: toIso(unloadingAt), unloadingContact, unloadingPhone,
          cargoDetails: cargoDetails || undefined,
        }),
      });
      setVehicleType(''); setLoadingPlace(''); setLoadingAt(''); setLoadingContact(''); setLoadingPhone('');
      setUnloadingPlace(''); setUnloadingAt(''); setUnloadingContact(''); setUnloadingPhone(''); setCargoDetails('');
      setApproverIds(['']);
      const defaults = ['윤대룡', '김부영'].map((n) => members.find((m) => m.name === n)?.id).filter((x): x is string => !!x);
      setFinalApproverIds(defaults);
      await loadCalendar();
      await loadList();
    } catch (err: any) {
      setError(err?.message || '신청 실패');
    } finally {
      setSubmitting(false);
    }
  }

  const weeks = useMemo(() => buildGrid(calMonth, calItems), [calMonth, calItems]);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16, display: 'grid', gap: 20 }}>
      <h2 style={{ margin: 0 }}>물류 배차 신청</h2>

      {/* 캘린더 + 신청폼 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(0,2fr)', gap: 16, alignItems: 'flex-start' }}>

        {/* 캘린더 */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <button type="button" onClick={() => changeMonth(-1)} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>◀</button>
            <b style={{ flex: 1, textAlign: 'center' }}>{calMonth}</b>
            <button type="button" onClick={() => changeMonth(1)} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>▶</button>
          </div>
          {calLoading ? <div style={{ color: '#94a3b8', padding: 20, textAlign: 'center' }}>로딩중…</div> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr>{['일','월','화','수','목','금','토'].map((d) => (
                  <th key={d} style={{ padding: 4, fontSize: 11, fontWeight: 700, color: '#64748b', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>{d}</th>
                ))}</tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((cell, ci) => (
                      <td key={ci} style={{ verticalAlign: 'top', borderBottom: '1px solid #f1f5f9', padding: 3, height: 72 }}>
                        {cell && (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2, color: ci === 0 ? '#ef4444' : ci === 6 ? '#3b82f6' : '#374151' }}>{cell.day}</div>
                            {cell.items.map((ev) => (
                              <div key={ev.id} onClick={() => clickCalItem(ev.id)} style={{ fontSize: 9, padding: '2px 4px', borderRadius: 4, marginBottom: 2, cursor: 'pointer', background: statusBg[ev.status] || '#fef9c3', border: '1px solid #cbd5e1', lineHeight: 1.3 }} title={`${ev.vehicleType} · ${ev.requesterName}`}>
                                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.vehicleType}</div>
                                <div style={{ color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.requesterName}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 신청 폼 */}
        <form onSubmit={handleSubmit} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, display: 'grid', gap: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: '#0F3D73' }}>물류 배차 신청서</h3>
          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', color: '#991b1b', fontSize: 13 }}>{error}</div>}
          <div>
            <label style={lbl}>필요 차종 *</label>
            <input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} style={inp} placeholder="예: 5톤 카고, 11톤 냉동차, 윙바디" />
          </div>
          <div>
            <div style={secHead}>📦 상차 정보</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div><label style={lbl}>상차 장소 *</label><input value={loadingPlace} onChange={(e) => setLoadingPlace(e.target.value)} style={inp} placeholder="주소 또는 장소명" /></div>
              <div><label style={lbl}>상차 일시 *</label><input type="datetime-local" value={loadingAt} onChange={(e) => setLoadingAt(e.target.value)} style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><label style={lbl}>담당자 *</label><input value={loadingContact} onChange={(e) => setLoadingContact(e.target.value)} style={inp} placeholder="이름" /></div>
                <div><label style={lbl}>전화번호 *</label><input value={loadingPhone} onChange={(e) => setLoadingPhone(e.target.value)} style={inp} placeholder="010-0000-0000" /></div>
              </div>
            </div>
          </div>
          <div>
            <div style={secHead}>🚚 하차 정보</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div><label style={lbl}>하차 장소 *</label><input value={unloadingPlace} onChange={(e) => setUnloadingPlace(e.target.value)} style={inp} placeholder="주소 또는 장소명" /></div>
              <div><label style={lbl}>하차 일시 *</label><input type="datetime-local" value={unloadingAt} onChange={(e) => setUnloadingAt(e.target.value)} style={inp} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><label style={lbl}>담당자 *</label><input value={unloadingContact} onChange={(e) => setUnloadingContact(e.target.value)} style={inp} placeholder="이름" /></div>
                <div><label style={lbl}>전화번호 *</label><input value={unloadingPhone} onChange={(e) => setUnloadingPhone(e.target.value)} style={inp} placeholder="010-0000-0000" /></div>
              </div>
            </div>
          </div>
          <div><label style={lbl}>화물 내용</label><input value={cargoDetails} onChange={(e) => setCargoDetails(e.target.value)} style={inp} placeholder="예: 금형 2개 약 200kg" /></div>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={lbl}>결재선 <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}>(관련부서 임원 → 대표이사 순으로 지정)</span></span>
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

            {/* 최종 담당자 (자동, 변경 가능) */}
            <div style={{ marginTop: 4 }}>
              <span style={{ ...lbl, display: 'block' }}>최종 담당자 <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}>(모든 결재 후 통보·처리 · 둘 중 한 명만 처리하면 완료)</span></span>
              <div style={{ fontSize: 12, color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '6px 10px', margin: '4px 0 6px' }}>
                기본으로 <b>윤대룡 · 김부영</b>에게 자동으로 갑니다. 필요하면 아래에서 변경할 수 있어요.
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {finalApproverIds.map((aid, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ minWidth: 52, fontSize: 12, color: '#475569', fontWeight: 700 }}>담당 {idx + 1}</span>
                    <ApproverIdPicker
                      value={aid}
                      onChange={(id) => setFinalApproverIds((prev) => prev.map((p, i) => i === idx ? id : p))}
                      members={members}
                      placeholder="이름 검색"
                    />
                    <button type="button" onClick={() => setFinalApproverIds((prev) => prev.filter((_, i) => i !== idx))} disabled={finalApproverIds.length <= 1}
                      style={{ padding: '4px 8px', fontSize: 12, border: '1px solid #CBD5E1', borderRadius: 6, background: '#fff', cursor: finalApproverIds.length <= 1 ? 'not-allowed' : 'pointer', color: finalApproverIds.length <= 1 ? '#cbd5e1' : '#475569' }}
                    >−</button>
                  </div>
                ))}
                <button type="button" onClick={() => setFinalApproverIds((prev) => [...prev, ''])}
                  style={{ justifySelf: 'start', padding: '4px 10px', fontSize: 12, border: '1px dashed #94a3b8', borderRadius: 6, background: '#f8fafc', cursor: 'pointer', color: '#475569' }}
                >+ 담당자 추가</button>
              </div>
            </div>
          </div>
          <button type="submit" disabled={submitting} style={{ background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: 10, fontSize: 14, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
            {submitting ? '신청중…' : '물류 배차 신청'}
          </button>
        </form>
      </div>

      {/* 신청 목록 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <b style={{ fontSize: 15 }}>신청 내역</b>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="">전체 상태</option>
            <option value="PENDING">대기중</option>
            <option value="APPROVED">승인</option>
            <option value="REJECTED">반려</option>
          </select>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={{ ...inp, width: 'auto' }} />
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={{ ...inp, width: 'auto' }} />
          <button onClick={loadList} style={{ background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13 }}>조회</button>
          <button onClick={() => { setFilterStatus(''); setFilterFrom(''); setFilterTo(''); setTimeout(loadList, 0); }} style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #CBD5E1', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13 }}>초기화</button>
        </div>
        {listLoading ? <div style={{ color: '#94a3b8' }}>로딩중…</div> : (
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                  {['상태','차종','신청자','상차 장소','상차 일시','상차 담당/연락','하차 장소','하차 일시','하차 담당/연락','화물','결재자','신청일'].map((h) => (
                    <th key={h} style={{ padding: '9px 10px', textAlign: 'left', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listItems.length === 0 ? (
                  <tr><td colSpan={12} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>신청 내역이 없습니다.</td></tr>
                ) : listItems.map((it, i) => (
                  <tr key={it.id} onClick={() => setSelectedEvent(it)} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafafa', cursor: 'pointer' }}>
                    <td style={{ padding: '8px 10px' }}><span style={{ background: statusBg[it.status], color: statusTx[it.status], borderRadius: 6, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>{statusLabel[it.status]}</span></td>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{it.vehicleType}</td>
                    <td style={{ padding: '8px 10px' }}>{it.requesterName}</td>
                    <td style={{ padding: '8px 10px' }}>{it.loadingPlace}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmt(it.loadingAt)}</td>
                    <td style={{ padding: '8px 10px' }}>{it.loadingContact}<br/><span style={{ fontSize: 11, color: '#64748b' }}>{it.loadingPhone}</span></td>
                    <td style={{ padding: '8px 10px' }}>{it.unloadingPlace}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{fmt(it.unloadingAt)}</td>
                    <td style={{ padding: '8px 10px' }}>{it.unloadingContact}<br/><span style={{ fontSize: 11, color: '#64748b' }}>{it.unloadingPhone}</span></td>
                    <td style={{ padding: '8px 10px', color: '#64748b' }}>{it.cargoDetails || '-'}</td>
                    <td style={{ padding: '8px 10px' }}>{it.approverName}</td>
                    <td style={{ padding: '8px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtDate(it.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {listItems.length > 0 && <div style={{ padding: '7px 12px', fontSize: 12, color: '#64748b', borderTop: '1px solid #f1f5f9' }}>총 {listItems.length}건</div>}
          </div>
        )}
      </div>

      {/* 상세 팝업 */}
      {selectedEvent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: 16 }} onClick={() => setSelectedEvent(null)}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, minWidth: 320, maxWidth: 480, width: '100%', boxShadow: '0 12px 40px rgba(15,23,42,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>물류 배차 상세</h3>
              <button onClick={() => setSelectedEvent(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#64748b' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gap: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ background: statusBg[selectedEvent.status], color: statusTx[selectedEvent.status], borderRadius: 6, padding: '2px 10px', fontWeight: 700, fontSize: 12 }}>{statusLabel[selectedEvent.status]}</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{selectedEvent.vehicleType}</span>
              </div>
              <div style={{ display: 'grid', gap: 6, background: '#f8fafc', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 700, color: '#0F3D73', marginBottom: 4 }}>📦 상차</div>
                <div><b>장소:</b> {selectedEvent.loadingPlace}</div>
                <div><b>일시:</b> {fmt(selectedEvent.loadingAt)}</div>
                <div><b>담당자:</b> {selectedEvent.loadingContact} · {selectedEvent.loadingPhone}</div>
              </div>
              <div style={{ display: 'grid', gap: 6, background: '#f8fafc', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 700, color: '#0F3D73', marginBottom: 4 }}>🚚 하차</div>
                <div><b>장소:</b> {selectedEvent.unloadingPlace}</div>
                <div><b>일시:</b> {fmt(selectedEvent.unloadingAt)}</div>
                <div><b>담당자:</b> {selectedEvent.unloadingContact} · {selectedEvent.unloadingPhone}</div>
              </div>
              {selectedEvent.cargoDetails && <div><b>화물 내용:</b> {selectedEvent.cargoDetails}</div>}
              <div style={{ color: '#64748b', fontSize: 12, borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>신청자: {selectedEvent.requesterName} · 결재자: {selectedEvent.approverName}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
