import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';
import { ApproverIdPicker } from '../components/MemberSearchPicker';

type Car = {
  id: string;
  name: string;
  type?: string | null;
};

type Approver = {
  id: string;
  name: string;
  role: string;
};

type CalendarItem = {
  id: string;
  carId: string;
  carName: string;
  startAt: string;
  endAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  requesterId?: string;
  requesterName: string;
  destination: string;
  purpose: string;
  coRiders?: string | null;
};

export function CarDispatchCorporate() {
  const [cars, setCars] = useState<Car[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [carId, setCarId] = useState('');
  const [members, setMembers] = useState<Approver[]>([]);
  const [approverId, setApproverId] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [coRiders, setCoRiders] = useState('');
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [isMobile, setIsMobile] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<{ ev: CalendarItem; dateLabel: string } | null>(null);

  // 협의(추가/교환) 배차
  type Conflict = { id: string; requesterName: string; startAt: string; endAt: string };
  const [conflict, setConflict] = useState<{ c: Conflict; payload: any } | null>(null);
  const [coUseNote, setCoUseNote] = useState('');
  const [coUseInbox, setCoUseInbox] = useState<any[]>([]);
  const [coUseMine, setCoUseMine] = useState<any[]>([]);
  const [canEditAny, setCanEditAny] = useState(false);
  const [editVals, setEditVals] = useState<any | null>(null);
  // 차량 교환
  const [swapInbox, setSwapInbox] = useState<any[]>([]);
  const [swapMine, setSwapMine] = useState<any[]>([]);
  const [swapFromId, setSwapFromId] = useState('');
  const [swapToId, setSwapToId] = useState('');
  const [swapNote, setSwapNote] = useState('');

  async function loadCoUse() {
    if (!userId) return;
    try {
      const [inbox, mine, sIn, sMine] = await Promise.all([
        apiJson<{ items: any[] }>(`/api/car-dispatch/co-use-inbox?userId=${encodeURIComponent(userId)}`),
        apiJson<{ items: any[] }>(`/api/car-dispatch/co-use-mine?requesterId=${encodeURIComponent(userId)}`),
        apiJson<{ items: any[] }>(`/api/car-dispatch/swap-inbox?userId=${encodeURIComponent(userId)}`),
        apiJson<{ items: any[] }>(`/api/car-dispatch/swap-mine?userId=${encodeURIComponent(userId)}`),
      ]);
      setCoUseInbox(inbox.items || []);
      setCoUseMine(mine.items || []);
      setSwapInbox(sIn.items || []);
      setSwapMine(sMine.items || []);
    } catch { /* ignore */ }
  }

  async function submitSwap() {
    if (!swapFromId || !swapToId) { alert('내 배차와 교환할 상대 배차를 선택하세요'); return; }
    try {
      await apiJson(`/api/car-dispatch/swap`, { method: 'POST', body: JSON.stringify({ fromDispatchId: swapFromId, toDispatchId: swapToId, actorId: userId, note: swapNote || undefined }) });
      setSwapFromId(''); setSwapToId(''); setSwapNote('');
      await loadCoUse();
      alert('차량 교환 요청을 보냈습니다. 상대가 동의하면 차량이 맞바뀝니다.');
    } catch (e: any) {
      alert(e?.message || '교환 요청에 실패했습니다');
    }
  }

  async function respondSwap(id: string, kind: 'agree' | 'decline') {
    try {
      await apiJson(`/api/car-dispatch/swap/${id}/${kind}`, { method: 'POST', body: JSON.stringify({ actorId: userId }) });
      await loadCoUse();
      await loadCalendar();
    } catch (e: any) {
      alert(e?.message || '처리에 실패했습니다');
    }
  }

  useEffect(() => {
    void loadCars();
    void loadMembers();
    void loadCoUse();
    (async () => {
      if (!userId) return;
      try {
        const me = await apiJson<{ role?: string; isAdmin?: boolean }>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setCanEditAny(!!me.isAdmin || me.role === 'CEO');
      } catch { /* ignore */ }
    })();
  }, []);

  function openEditEvent(ev: CalendarItem) {
    const d = new Date(ev.startAt); const e = new Date(ev.endAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    setEditVals({
      id: ev.id, carId: ev.carId,
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      start: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      end: `${pad(e.getHours())}:${pad(e.getMinutes())}`,
      destination: ev.destination, purpose: ev.purpose, coRiders: ev.coRiders || '',
    });
  }
  async function saveEditEvent() {
    if (!editVals) return;
    try {
      await apiJson(`/api/car-dispatch/${editVals.id}`, { method: 'PUT', body: JSON.stringify({
        actorId: userId, carId: editVals.carId,
        startAt: toIso(editVals.date, editVals.start), endAt: toIso(editVals.date, editVals.end),
        destination: editVals.destination, purpose: editVals.purpose, coRiders: editVals.coRiders,
      }) });
      setEditVals(null); setSelectedEvent(null); await loadCalendar();
      alert('수정되었습니다');
    } catch (e: any) { alert(e?.message || '수정에 실패했습니다'); }
  }
  async function cancelEventDispatch() {
    if (!editVals) return;
    if (!confirm('이 배차를 취소할까요?')) return;
    try {
      await apiJson(`/api/car-dispatch/${editVals.id}`, { method: 'PUT', body: JSON.stringify({ actorId: userId, cancel: true }) });
      setEditVals(null); setSelectedEvent(null); await loadCalendar();
    } catch (e: any) { alert(e?.message || '취소에 실패했습니다'); }
  }

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

  useEffect(() => {
    void loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarMonth]);

  async function loadCars() {
    try {
      const res = await apiJson<{ items: Car[] }>(`/api/cars`);
      setCars(res.items || []);
      if (!carId && res.items && res.items.length > 0) setCarId(res.items[0].id);
    } catch (e: any) {
      console.error(e);
    }
  }

  async function loadMembers() {
    try {
      const res = await apiJson<{ items: { id: string; name: string; role: string }[] }>('/api/users');
      const all = (res.items || []).map((u) => ({ id: u.id, name: u.name, role: u.role }));
      setMembers(all);
      const hongJeongSu = all.find((m) => m.name === '홍정수');
      if (hongJeongSu && !approverId) setApproverId(hongJeongSu.id);
    } catch (e: any) {
      console.error(e);
    }
  }

  async function loadCalendar() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: CalendarItem[] }>(`/api/car-dispatch/calendar?month=${encodeURIComponent(calendarMonth)}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '배차 달력을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  const weeks = useMemo(() => buildMonthGrid(calendarMonth, items), [calendarMonth, items]);

  async function submitCoUse() {
    if (!conflict) return;
    try {
      await apiJson(`/api/car-dispatch/co-use`, { method: 'POST', body: JSON.stringify({ ...conflict.payload, note: coUseNote || undefined }) });
      setConflict(null);
      setCoUseNote('');
      await loadCoUse();
      alert(`${conflict.c.requesterName || '선점자'}님에게 협의 배차 요청을 보냈습니다. 선점자가 동의하면 별도 결재 없이 확정됩니다.`);
    } catch (e: any) {
      alert(e?.message || '협의 요청에 실패했습니다');
    }
  }

  async function respondCoUse(id: string, kind: 'agree' | 'decline') {
    try {
      await apiJson(`/api/car-dispatch/${id}/${kind}`, { method: 'POST', body: JSON.stringify({ actorId: userId }) });
      await loadCoUse();
      await loadCalendar();
    } catch (e: any) {
      alert(e?.message || '처리에 실패했습니다');
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) {
      alert('로그인이 필요합니다');
      return;
    }
    if (!carId || !date || !startTime || !endTime || !destination || !purpose) {
      alert('필수 항목을 입력해 주세요');
      return;
    }
    const startAtIso = toIso(date, startTime);
    const endAtIso = toIso(date, endTime);
    setSubmitting(true);
    setError(null);
    try {
      await apiJson(`/api/car-dispatch`, {
        method: 'POST',
        body: JSON.stringify({
          carId,
          requesterId: userId,
          approverId: approverId || undefined,
          coRiders: coRiders || undefined,
          startAt: startAtIso,
          endAt: endAtIso,
          destination,
          purpose,
        }),
      });
      await loadCalendar();
      alert('배차 신청이 등록되었습니다');
    } catch (e: any) {
      const body = e?.body;
      if (body && body.code === 'DISPATCH_CONFLICT' && body.conflict) {
        // 선점자와 협의(추가/교환) 배차 제안
        setCoUseNote('');
        setConflict({
          c: body.conflict,
          payload: { carId, requesterId: userId, approverId: approverId || undefined, coRiders: coRiders || undefined, startAt: startAtIso, endAt: endAtIso, destination, purpose, conflictDispatchId: body.conflict.id },
        });
      } else {
        alert(e?.message || '배차 신청에 실패했습니다');
      }
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
    <div className="content" style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', alignItems: 'flex-start' }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#ffffff' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <button type="button" onClick={() => changeMonth(-1)} style={{ marginRight: 8 }}>◀</button>
            <b>{calendarMonth}</b>
            <button type="button" onClick={() => changeMonth(1)} style={{ marginLeft: 8 }}>▶</button>
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
                            padding: 3,
                            height: isMobile ? 'auto' : 70,
                          }}
                        >
                          {cell && (
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{cell.day}</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {cell.items.map(ev => (
                                  <div
                                    key={ev.id}
                                    style={{
                                      fontSize: isMobile ? 8 : 9,
                                      padding: '2px 4px',
                                      borderRadius: 4,
                                      background:
                                        ev.status === 'APPROVED'
                                          ? '#dcfce7' // green
                                          : ev.status === 'REJECTED'
                                            ? '#fee2e2' // red
                                            : '#fef9c3', // pending = yellow
                                      border: '1px solid #cbd5e1',
                                      overflow: isMobile ? 'visible' : 'hidden',
                                      textOverflow: isMobile ? 'clip' : 'ellipsis',
                                      whiteSpace: 'normal',
                                      cursor: 'pointer',
                                    }}
                                    title={`${ev.carName} · ${ev.requesterName}`}
                                    onClick={() => {
                                      const dateLabel = `${calendarMonth}-${String(cell.day).padStart(2, '0')}`;
                                      setSelectedEvent({ ev, dateLabel });
                                    }}
                                  >
                                    {ev.carName}
                                    <br />
                                    {ev.requesterName}
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
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 8, maxWidth: 520, border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#ffffff' }}>
          <h2 style={{ marginTop: 0 }}>법인차량 신청</h2>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>차량 선택</span>
            <select value={carId} onChange={(e) => setCarId(e.target.value)}>
              <option value="">선택</option>
              {cars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.type ? ` (${c.type})` : ''}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>1차 결재자</span>
            <ApproverIdPicker
              value={approverId}
              onChange={setApproverId}
              members={members}
              placeholder="결재자 이름 검색 (기본: 홍정수)"
            />
          </div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>필요 일자</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 4, flex: 1 }}>
              <span>시작 시간</span>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 4, flex: 1 }}>
              <span>종료 시간</span>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </label>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>동승자</span>
            <input type="text" placeholder="동승자 이름들" value={coRiders} onChange={(e) => setCoRiders(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>목적지</span>
            <input type="text" value={destination} onChange={(e) => setDestination(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>목적</span>
            <input type="text" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </label>
          <div style={{ marginTop: 8 }}>
            <button type="submit" disabled={submitting}>
              {submitting ? '신청 중…' : '배차 신청'}
            </button>
          </div>
        </form>
      </div>

      {(coUseInbox.length > 0 || coUseMine.length > 0) && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr' }}>
          {coUseInbox.length > 0 && (
            <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 800, color: '#92400e', marginBottom: 8 }}>🔔 내게 온 협의 배차 요청 (선점자)</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {coUseInbox.map((r) => (
                  <div key={r.id} style={{ border: '1px solid #fcd34d', borderRadius: 8, padding: 8, background: '#fff' }}>
                    <div style={{ fontSize: 13 }}>
                      <b>{r.requesterName}</b>님 · {r.carName}{r.carPlateNo ? ` (${r.carPlateNo})` : ''}
                    </div>
                    <div style={{ fontSize: 13, color: '#475569' }}>{formatDateTime(r.startAt)}~{formatTime(r.endAt)} · {r.destination} · {r.purpose}</div>
                    {r.negotiationNote && <div style={{ fontSize: 13, color: '#92400e', marginTop: 2 }}>“{r.negotiationNote}”</div>}
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => void respondCoUse(r.id, 'agree')}>동의(결재 진행)</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void respondCoUse(r.id, 'decline')}>거절</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {coUseMine.length > 0 && (
            <div style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>내가 보낸 협의 배차 요청</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {coUseMine.map((r) => {
                  const st = r.negotiationStatus === 'AGREED' ? { t: '동의됨(확정)', c: '#166534', b: '#dcfce7' } : r.negotiationStatus === 'DECLINED' ? { t: '거절됨', c: '#991b1b', b: '#fee2e2' } : { t: '대기중', c: '#854d0e', b: '#fef9c3' };
                  return (
                    <div key={r.id} style={{ border: '1px solid #f1f5f9', borderRadius: 8, padding: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ fontSize: 13 }}>{r.carName} · {formatDateTime(r.startAt)}~{formatTime(r.endAt)}</div>
                        <span style={{ background: st.b, color: st.c, borderRadius: 999, padding: '1px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{st.t}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{r.destination} · {r.purpose}{r.negotiationNote ? ` · “${r.negotiationNote}”` : ''}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 차량 교환 */}
      <details style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: '8px 12px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 800, color: '#0f172a' }}>🔄 차량 교환 요청 (같은 시간 선점한 다른 차량과 맞바꾸기)</summary>
        <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
          {(() => {
            const mine = items.filter((i) => i.requesterId === userId && (i.status === 'PENDING' || i.status === 'APPROVED'));
            const from = items.find((i) => i.id === swapFromId);
            const overlap = (a: CalendarItem, b: CalendarItem) => new Date(a.startAt) < new Date(b.endAt) && new Date(b.startAt) < new Date(a.endAt);
            const candidates = from ? items.filter((i) => i.id !== from.id && i.requesterId && i.requesterId !== userId && i.carId !== from.carId && (i.status === 'PENDING' || i.status === 'APPROVED') && overlap(from, i)) : [];
            return (
              <>
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>내 배차 (교환할 내 차량)</span>
                  <select value={swapFromId} onChange={(e) => { setSwapFromId(e.target.value); setSwapToId(''); }} style={{ padding: '6px 8px' }}>
                    <option value="">선택 ({calendarMonth} 기준)</option>
                    {mine.map((m) => <option key={m.id} value={m.id}>{m.carName} · {formatDateTime(m.startAt)}~{formatTime(m.endAt)} · {m.destination}</option>)}
                  </select>
                </label>
                {from && (
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: '#475569' }}>교환할 상대 배차 (같은 시간대 다른 차량)</span>
                    <select value={swapToId} onChange={(e) => setSwapToId(e.target.value)} style={{ padding: '6px 8px' }}>
                      <option value="">선택</option>
                      {candidates.map((c) => <option key={c.id} value={c.id}>{c.requesterName} · {c.carName} · {formatDateTime(c.startAt)}~{formatTime(c.endAt)}</option>)}
                    </select>
                    {candidates.length === 0 && <span style={{ fontSize: 11, color: '#94a3b8' }}>겹치는 시간대의 다른 차량 배차가 없습니다.</span>}
                  </label>
                )}
                <label style={{ display: 'grid', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>메모 (선택)</span>
                  <input value={swapNote} onChange={(e) => setSwapNote(e.target.value)} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
                </label>
                <div><button type="button" className="btn btn-sm" disabled={!swapFromId || !swapToId} onClick={() => void submitSwap()}>교환 요청 보내기</button></div>
              </>
            );
          })()}

          {swapInbox.length > 0 && (
            <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 6 }}>🔔 내게 온 차량 교환 요청</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {swapInbox.map((r) => (
                  <div key={r.id} style={{ border: '1px solid #fcd34d', borderRadius: 8, padding: 8, background: '#fff', fontSize: 13 }}>
                    <div><b>{r.from?.requesterName}</b>님이 교환 요청: <b>{r.from?.carName}</b> ↔ 내 <b>{r.to?.carName}</b></div>
                    <div style={{ color: '#64748b' }}>{r.to ? `${formatDateTime(r.to.startAt)}~${formatTime(r.to.endAt)}` : ''}{r.note ? ` · “${r.note}”` : ''}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button type="button" className="btn btn-sm" onClick={() => void respondSwap(r.id, 'agree')}>동의(차량 맞바꿈)</button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void respondSwap(r.id, 'decline')}>거절</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {swapMine.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>내가 보낸 교환 요청</div>
              {swapMine.map((r) => {
                const st = r.status === 'AGREED' ? { t: '교환 완료', c: '#166534', b: '#dcfce7' } : r.status === 'DECLINED' ? { t: '거절됨', c: '#991b1b', b: '#fee2e2' } : { t: '대기중', c: '#854d0e', b: '#fef9c3' };
                return (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, border: '1px solid #f1f5f9', borderRadius: 8, padding: 8 }}>
                    <div>{r.from?.carName} ↔ {r.to?.carName} ({r.to?.requesterName})</div>
                    <span style={{ background: st.b, color: st.c, borderRadius: 999, padding: '1px 10px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{st.t}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>

      {conflict && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2600, padding: 16 }} onClick={() => setConflict(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 18, width: 420, maxWidth: '95%', display: 'grid', gap: 10 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>이미 선점된 시간입니다</div>
            <div style={{ fontSize: 14, color: '#334155' }}>
              <b>{conflict.c.requesterName || '다른 사용자'}</b>님이 {formatDateTime(conflict.c.startAt)}~{formatTime(conflict.c.endAt)}에 선점했습니다.<br />
              남는 시간 사용·차량 교환 등 <b>협의 배차</b>를 선점자에게 요청할 수 있습니다.
            </div>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 12, color: '#475569' }}>협의 메모 (예: 오후 2시 이후 사용 / 차량 교환 희망)</span>
              <textarea value={coUseNote} onChange={(e) => setCoUseNote(e.target.value)} rows={3} style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConflict(null)}>취소</button>
              <button type="button" className="btn btn-sm" onClick={() => void submitCoUse()}>협의 배차 요청</button>
            </div>
          </div>
        </div>
      )}

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
            const editable = canEditAny || (!!ev.requesterId && ev.requesterId === userId);
            const isEditing = editVals && editVals.id === ev.id;
            if (isEditing) {
              const fld: React.CSSProperties = { padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6, width: '100%' };
              const set = (k: string, v: any) => setEditVals((p: any) => ({ ...p, [k]: v }));
              return (
                <>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>배차 수정</div>
                  <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                    <label style={{ display: 'grid', gap: 3 }}><span style={{ color: '#475569' }}>차량</span>
                      <select style={fld} value={editVals.carId} onChange={(e) => set('carId', e.target.value)}>
                        {cars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.type ? ` (${c.type})` : ''}</option>)}
                      </select></label>
                    <label style={{ display: 'grid', gap: 3 }}><span style={{ color: '#475569' }}>일자</span>
                      <input type="date" style={fld} value={editVals.date} onChange={(e) => set('date', e.target.value)} /></label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <label style={{ display: 'grid', gap: 3, flex: 1 }}><span style={{ color: '#475569' }}>시작</span>
                        <input type="time" style={fld} value={editVals.start} onChange={(e) => set('start', e.target.value)} /></label>
                      <label style={{ display: 'grid', gap: 3, flex: 1 }}><span style={{ color: '#475569' }}>종료</span>
                        <input type="time" style={fld} value={editVals.end} onChange={(e) => set('end', e.target.value)} /></label>
                    </div>
                    <label style={{ display: 'grid', gap: 3 }}><span style={{ color: '#475569' }}>목적지</span>
                      <input style={fld} value={editVals.destination} onChange={(e) => set('destination', e.target.value)} /></label>
                    <label style={{ display: 'grid', gap: 3 }}><span style={{ color: '#475569' }}>목적</span>
                      <input style={fld} value={editVals.purpose} onChange={(e) => set('purpose', e.target.value)} /></label>
                    <label style={{ display: 'grid', gap: 3 }}><span style={{ color: '#475569' }}>동승자</span>
                      <input style={fld} value={editVals.coRiders} onChange={(e) => set('coRiders', e.target.value)} /></label>
                  </div>
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                    <button type="button" className="btn btn-sm btn-ghost" style={{ color: '#b91c1c' }} onClick={() => void cancelEventDispatch()}>배차 취소</button>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditVals(null)}>되돌리기</button>
                      <button type="button" className="btn btn-sm" onClick={() => void saveEditEvent()}>저장</button>
                    </div>
                  </div>
                </>
              );
            }
            return (
              <>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>{dateLabel}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                  {ev.carName}
                </div>
                <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                  <div><strong>신청자</strong> {ev.requesterName}</div>
                  <div>
                    <strong>시간</strong> {formatTime(ev.startAt)}~{formatTime(ev.endAt)}
                  </div>
                  <div><strong>목적지</strong> {ev.destination}</div>
                  {ev.coRiders && (
                    <div><strong>동승자</strong> {ev.coRiders}</div>
                  )}
                  <div><strong>목적</strong> {ev.purpose}</div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  {editable && <button type="button" className="btn btn-sm" onClick={() => openEditEvent(ev)}>수정</button>}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedEvent(null)}>닫기</button>
                </div>
              </>
            );
          })()}
        </div>
      </div>
      ) : null}
    </div>
  );
}

function toIso(date: string, time: string): string {
  // date: YYYY-MM-DD, time: HH:MM (interpreted as KST, UTC+9)
  if (!date || !time) return '';
  const isoKst = `${date}T${time}:00+09:00`;
  const d = new Date(isoKst);
  return d.toISOString();
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
      const s = new Date(it.startAt);
      const e = new Date(it.endAt);
      return e >= dayStart && s <= dayEnd;
    });
    cells.push({ day: d, items: evs });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<{ day: number; items: CalendarItem[] } | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${mo}/${da} ${formatTime(iso)}`;
}
