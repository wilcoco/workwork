import { useCallback, useEffect, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';

type BoardItem = {
  id: string;
  carName: string;
  carPlateNo: string;
  requesterName: string;
  guardCreated: boolean;
  coRiders: string;
  startAt: string;
  endAt: string;
  destination: string;
  purpose: string;
  status: string;
  carLastOdometer: number | null;
  carLastOdometerAt: string | null;
  carLastOdometerSource: string | null;
  checkoutAt: string | null;
  checkinAt: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceKm: number | null;
  statusPhotosBefore: Photo[];
  statusPhotosAfter: Photo[];
  odometerPhotosBefore: Photo[];
  odometerPhotosAfter: Photo[];
  odometerBeforeOcr: number | null;
  odometerAfterOcr: number | null;
  usageNote: string;
  usageRegisteredAt: string | null;
};

type Photo = { url?: string; name?: string };
type CarOdometer = { carId: string; carName: string; carType: string; carPlateNo: string; odometer: number | null; at: string | null; source: string | null };

function kstToday(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// ISO(UTC) → datetime-local 입력값(KST) 'YYYY-MM-DDTHH:MM'
function isoToLocalInput(iso: string | null): string {
  const base = iso ? new Date(iso) : new Date();
  if (isNaN(base.getTime())) return '';
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 16);
}

// datetime-local 입력값(KST) → ISO. 빈 값이면 undefined
function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}:00+09:00`);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function fmtTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function phase(it: BoardItem): { label: string; color: string; bg: string } {
  if (it.checkinAt) return { label: '입차완료', color: '#166534', bg: '#dcfce7' };
  if (it.checkoutAt) return { label: '운행중', color: '#9a3412', bg: '#ffedd5' };
  return { label: '출차대기', color: '#1e3a8a', bg: '#dbeafe' };
}

function parseKm(v: string): number | undefined {
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

type Car = { id: string; name: string; type?: string | null; plateNo?: string | null };

export function GuardDispatchBoard() {
  const [date, setDate] = useState<string>(kstToday());
  const [items, setItems] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; title: string } | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [carOdos, setCarOdos] = useState<CarOdometer[]>([]);

  const loadCarOdos = useCallback(async () => {
    try {
      const res = await apiJson<{ items: CarOdometer[] }>(`/api/car-dispatch/car-odometers`);
      setCarOdos(res.items || []);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: BoardItem[] }>(`/api/car-dispatch/guard-board?date=${encodeURIComponent(date)}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '현황을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: Car[] }>(`/api/cars`);
        setCars(res.items || []);
      } catch { /* ignore */ }
    })();
    void loadCarOdos();
  }, [loadCarOdos]);

  const resolveUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : apiUrl(u || ''));

  return (
    <div className="content" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>🚗 배차 입·출차 현황 (경비실)</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => setShowCreate(true)} className="btn btn-sm" style={{ background: '#b91c1c', color: '#fff' }}>＋ 긴급 출차 등록</button>
          <button type="button" onClick={() => setDate(kstToday())} className="btn btn-sm">오늘</button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" onClick={() => { void load(); void loadCarOdos(); }} className="btn btn-sm">새로고침</button>
        </div>
      </div>
      <div style={{ color: '#475569', fontSize: 13 }}>
        차량 출차·입차 시 <b>시각</b>과 <b>적산거리(km)</b>를 확인해 입력하세요. 입차 시 적산거리를 입력하면 주행거리가 자동 계산됩니다.
        결재 전 긴급 출차는 <b>＋ 긴급 출차 등록</b>으로 즉시 등록할 수 있습니다.
      </div>

      {carOdos.length > 0 && (
        <details open style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', padding: '8px 12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 800, color: '#0f172a' }}>🚙 차량별 현재 누적거리 (인증 기준)</summary>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>차량</th>
                  <th style={{ padding: '4px 8px' }}>차량번호</th>
                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>현재 누적거리</th>
                  <th style={{ padding: '4px 8px' }}>인증</th>
                  <th style={{ padding: '4px 8px' }}>기준일</th>
                </tr>
              </thead>
              <tbody>
                {carOdos.map((c) => (
                  <tr key={c.carId} style={{ borderTop: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '4px 8px', fontWeight: 600 }}>{c.carName}{c.carType ? ` (${c.carType})` : ''}</td>
                    <td style={{ padding: '4px 8px', color: '#475569' }}>{c.carPlateNo || '-'}</td>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700 }}>{c.odometer != null ? `${c.odometer.toLocaleString()}km` : '미인증'}</td>
                    <td style={{ padding: '4px 8px', color: '#0369a1' }}>{c.source || '-'}</td>
                    <td style={{ padding: '4px 8px', color: '#475569' }}>{c.at ? fmtDate(c.at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6 }}>※ 경비 출/입차 확인 또는 계기판 사진이 첨부된 등록만 인증 값으로 집계합니다.</div>
        </details>
      )}

      {showCreate && (
        <EmergencyCreate
          cars={cars}
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await load(); await loadCarOdos(); }}
        />
      )}

      {error && <div style={{ color: 'red' }}>{error}</div>}
      {loading ? (
        <div>불러오는 중…</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#64748b', padding: 24, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12 }}>
          해당 일자에 배차된 차량이 없습니다.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map((it) => (
            <DispatchCard key={it.id} item={it} onSaved={async () => { await load(); await loadCarOdos(); }} onPhoto={(u, t) => setPhoto({ url: resolveUrl(u), title: t })} resolveUrl={resolveUrl} />
          ))}
        </div>
      )}

      {photo && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }}
          onClick={() => setPhoto(null)}
        >
          <img src={photo.url} alt={photo.title} style={{ maxWidth: '95%', maxHeight: '95%', borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}

function DispatchCard({
  item,
  onSaved,
  onPhoto,
  resolveUrl,
}: {
  item: BoardItem;
  onSaved: () => Promise<void> | void;
  onPhoto: (url: string, title: string) => void;
  resolveUrl: (u?: string) => string;
}) {
  const actorId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const p = phase(item);

  const [outAt, setOutAt] = useState(isoToLocalInput(item.checkoutAt));
  const [outOdo, setOutOdo] = useState(item.odometerStart != null ? String(item.odometerStart) : '');
  const [inAt, setInAt] = useState(isoToLocalInput(item.checkinAt));
  const [inOdo, setInOdo] = useState(item.odometerEnd != null ? String(item.odometerEnd) : '');
  const [busy, setBusy] = useState<'out' | 'in' | null>(null);

  // 서버 데이터 갱신 시 입력값 동기화
  useEffect(() => {
    setOutAt(isoToLocalInput(item.checkoutAt));
    setOutOdo(item.odometerStart != null ? String(item.odometerStart) : '');
    setInAt(isoToLocalInput(item.checkinAt));
    setInOdo(item.odometerEnd != null ? String(item.odometerEnd) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.checkoutAt, item.checkinAt, item.odometerStart, item.odometerEnd]);

  async function save(kind: 'checkout' | 'checkin') {
    const at = kind === 'checkout' ? outAt : inAt;
    const odo = kind === 'checkout' ? outOdo : inOdo;
    const body: any = { actorId };
    const iso = localInputToIso(at);
    if (iso) body.at = iso;
    const km = parseKm(odo);
    if (km !== undefined) body.odometer = km;
    setBusy(kind === 'checkout' ? 'out' : 'in');
    try {
      await apiJson(`/api/car-dispatch/${item.id}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      await onSaved();
    } catch (e: any) {
      alert(e?.message || '저장에 실패했습니다');
    } finally {
      setBusy(null);
    }
  }

  const fieldStyle: React.CSSProperties = { padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 6 };

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            {item.carName} <span style={{ color: '#475569', fontWeight: 600 }}>{item.carPlateNo}</span>
          </div>
          <div style={{ fontSize: 13, color: '#334155', marginTop: 2 }}>
            신청자 <b>{item.requesterName}</b>{item.coRiders ? ` · 동승 ${item.coRiders}` : ''}
          </div>
          <div style={{ fontSize: 13, color: '#334155' }}>
            운행예정 {fmtTime(item.startAt)}~{fmtTime(item.endAt)}
          </div>
          <div style={{ fontSize: 13, color: '#334155' }}>
            <span style={{ color: '#64748b' }}>목적지</span> <b>{item.destination || '-'}</b>
          </div>
          <div style={{ fontSize: 13, color: '#334155' }}>
            <span style={{ color: '#64748b' }}>목적</span> <b>{item.purpose || '-'}</b>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {item.guardCreated && (
            <span style={{ background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 999, padding: '3px 10px', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>긴급</span>
          )}
          {item.status === 'PENDING' && !item.guardCreated && (
            <span style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a', borderRadius: 999, padding: '3px 10px', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>결재 전</span>
          )}
          <span style={{ background: p.bg, color: p.color, borderRadius: 999, padding: '3px 12px', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>{p.label}</span>
        </div>
      </div>

      {item.carLastOdometer != null && (
        <div style={{ fontSize: 12, color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '6px 10px' }}>
          📌 이 차량 현재 누적거리(인증 기준): <b>{item.carLastOdometer.toLocaleString()}km</b>
          {item.carLastOdometerAt ? ` (${fmtDate(item.carLastOdometerAt)}` : ''}{item.carLastOdometerSource ? `, ${item.carLastOdometerSource})` : item.carLastOdometerAt ? ')' : ''} — 새 운행거리 계산 시 참고하세요.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        {/* 출차 입력 */}
        <div style={{ border: '1px solid #f1f5f9', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>출차 확인 {item.checkoutAt && <span style={{ color: '#16a34a', fontSize: 12 }}>✓ 기록됨</span>}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, color: '#475569' }}>
              출차 시각
              <input type="datetime-local" value={outAt} onChange={(e) => setOutAt(e.target.value)} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, color: '#475569' }}>
              출발 적산거리(km)
              <input inputMode="numeric" value={outOdo} onChange={(e) => setOutOdo(e.target.value)} placeholder="예: 45120" style={fieldStyle} />
            </label>
            <PhotoVerify
              label="운전자 사용 전 계기판"
              photos={item.odometerPhotosBefore}
              recognized={item.odometerBeforeOcr}
              onPhoto={onPhoto}
              resolveUrl={resolveUrl}
            />
            <button type="button" className="btn btn-sm" disabled={busy === 'out'} onClick={() => void save('checkout')}>
              {busy === 'out' ? '저장 중…' : item.checkoutAt ? '출차 수정' : '출차 저장'}
            </button>
          </div>
        </div>

        {/* 입차 입력 */}
        <div style={{ border: '1px solid #f1f5f9', borderRadius: 8, padding: 10, background: '#f8fafc' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>입차 확인 {item.checkinAt && <span style={{ color: '#16a34a', fontSize: 12 }}>✓ 기록됨</span>}</div>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, color: '#475569' }}>
              입차 시각
              <input type="datetime-local" value={inAt} onChange={(e) => setInAt(e.target.value)} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 3, fontSize: 12, color: '#475569' }}>
              복귀 적산거리(km)
              <input inputMode="numeric" value={inOdo} onChange={(e) => setInOdo(e.target.value)} placeholder="예: 45260" style={fieldStyle} />
            </label>
            <PhotoVerify
              label="운전자 사용 후 계기판"
              photos={item.odometerPhotosAfter}
              recognized={item.odometerAfterOcr}
              onPhoto={onPhoto}
              resolveUrl={resolveUrl}
            />
            <button type="button" className="btn btn-sm" disabled={busy === 'in' || !item.checkoutAt} onClick={() => void save('checkin')}>
              {busy === 'in' ? '저장 중…' : item.checkinAt ? '입차 수정' : '입차 저장'}
            </button>
            {!item.checkoutAt && <span style={{ fontSize: 11, color: '#94a3b8' }}>출차 저장 후 입력 가능</span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#475569' }}>
        <span>출차 {fmtTime(item.checkoutAt)}{item.odometerStart != null ? ` · ${item.odometerStart.toLocaleString()}km` : ''}</span>
        <span>입차 {fmtTime(item.checkinAt)}{item.odometerEnd != null ? ` · ${item.odometerEnd.toLocaleString()}km` : ''}</span>
        <span style={{ fontWeight: 700, color: '#0f172a' }}>주행거리 {item.distanceKm != null ? `${item.distanceKm.toLocaleString()}km` : '-'}</span>
      </div>

      {([item.statusPhotosBefore, item.statusPhotosAfter, item.odometerPhotosBefore, item.odometerPhotosAfter].some((a) => (a?.length || 0) > 0)) && (
        <div style={{ borderTop: '1px dashed #e5e7eb', paddingTop: 8, display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>📸 운전자 등록 사진</div>
          {((item.statusPhotosBefore?.length || 0) > 0 || (item.statusPhotosAfter?.length || 0) > 0) && (
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>차량 상태</div>
              <PhotoGroup label="사용 전" photos={item.statusPhotosBefore} onPhoto={onPhoto} resolveUrl={resolveUrl} />
              <PhotoGroup label="사용 후" photos={item.statusPhotosAfter} onPhoto={onPhoto} resolveUrl={resolveUrl} />
            </div>
          )}
          {((item.odometerPhotosBefore?.length || 0) > 0 || (item.odometerPhotosAfter?.length || 0) > 0) && (
            <div style={{ display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>계기판(적산거리)</div>
              <PhotoGroup label="사용 전" photos={item.odometerPhotosBefore} onPhoto={onPhoto} resolveUrl={resolveUrl} />
              <PhotoGroup label="사용 후" photos={item.odometerPhotosAfter} onPhoto={onPhoto} resolveUrl={resolveUrl} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhotoVerify({
  label,
  photos,
  recognized,
  onPhoto,
  resolveUrl,
}: {
  label: string;
  photos: Photo[];
  recognized: number | null;
  onPhoto: (url: string, title: string) => void;
  resolveUrl: (u?: string) => string;
}) {
  const list = (photos || []).filter((x) => x && x.url);
  if (list.length === 0 && recognized == null) return null;
  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 8, display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>
        📷 사진 인증 · {label}
        {recognized != null && <span style={{ marginLeft: 6, color: '#0f172a' }}>인식 {recognized.toLocaleString()}km</span>}
      </div>
      {list.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {list.map((ph, i) => (
            <img
              key={i}
              src={resolveUrl(ph.url)}
              alt={ph.name || 'odometer'}
              style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid #fcd34d', cursor: 'pointer' }}
              onClick={() => onPhoto(ph.url || '', ph.name || '')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmergencyCreate({
  cars,
  onClose,
  onCreated,
}: {
  cars: Car[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const actorId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [carId, setCarId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const [coRiders, setCoRiders] = useState('');
  const [startAt, setStartAt] = useState(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return kst.toISOString().slice(0, 16);
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!carId) { alert('차량을 선택하세요'); return; }
    if (!driverName.trim()) { alert('운전자명을 입력하세요'); return; }
    if (!destination.trim() || !purpose.trim()) { alert('목적지와 목적을 입력하세요'); return; }
    setBusy(true);
    try {
      await apiJson(`/api/car-dispatch/guard-create`, {
        method: 'POST',
        body: JSON.stringify({
          carId,
          actorId,
          driverName: driverName.trim(),
          destination: destination.trim(),
          purpose: purpose.trim(),
          coRiders: coRiders.trim() || undefined,
          startAt: startAt ? new Date(`${startAt}:00+09:00`).toISOString() : undefined,
        }),
      });
      await onCreated();
    } catch (e: any) {
      alert(e?.message || '긴급 등록에 실패했습니다');
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6 };
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }}
      onClick={onClose}
    >
      <div style={{ background: '#fff', borderRadius: 12, padding: 18, width: 420, maxWidth: '95%', display: 'grid', gap: 10 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: 16, color: '#b91c1c' }}>긴급 출차 등록 (결재 없이 즉시)</div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>차량</span>
          <select value={carId} onChange={(e) => setCarId(e.target.value)} style={field}>
            <option value="">선택</option>
            {cars.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.type ? ` (${c.type})` : ''}{c.plateNo ? ` · ${c.plateNo}` : ''}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>운전자명</span>
          <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="예: 홍길동" style={field} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>출차 시각</span>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={field} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>목적지</span>
          <input value={destination} onChange={(e) => setDestination(e.target.value)} style={field} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>목적</span>
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} style={field} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span style={{ fontSize: 12, color: '#475569' }}>동승자 <span style={{ color: '#94a3b8' }}>(선택)</span></span>
          <input value={coRiders} onChange={(e) => setCoRiders(e.target.value)} style={field} />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn btn-sm" style={{ background: '#b91c1c', color: '#fff' }} disabled={busy} onClick={() => void submit()}>
            {busy ? '등록 중…' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoGroup({
  label,
  photos,
  onPhoto,
  resolveUrl,
}: {
  label: string;
  photos: Photo[];
  onPhoto: (url: string, title: string) => void;
  resolveUrl: (u?: string) => string;
}) {
  const list = (photos || []).filter((x) => x && x.url);
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: '#64748b', minWidth: 44 }}>{label}</span>
      {list.map((ph, i) => (
        <img
          key={i}
          src={resolveUrl(ph.url)}
          alt={ph.name || 'photo'}
          style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'pointer' }}
          onClick={() => onPhoto(ph.url || '', ph.name || '')}
        />
      ))}
    </div>
  );
}
