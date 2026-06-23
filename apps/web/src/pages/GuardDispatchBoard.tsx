import { useCallback, useEffect, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';

type BoardItem = {
  id: string;
  carName: string;
  carPlateNo: string;
  requesterName: string;
  coRiders: string;
  startAt: string;
  endAt: string;
  destination: string;
  purpose: string;
  status: string;
  checkoutAt: string | null;
  checkinAt: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceKm: number | null;
  statusPhotos: { url?: string; name?: string }[];
  odometerPhotos: { url?: string; name?: string }[];
  usageNote: string;
  usageRegisteredAt: string | null;
};

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

function phase(it: BoardItem): { label: string; color: string; bg: string } {
  if (it.checkinAt) return { label: '입차완료', color: '#166534', bg: '#dcfce7' };
  if (it.checkoutAt) return { label: '운행중', color: '#9a3412', bg: '#ffedd5' };
  return { label: '출차대기', color: '#1e3a8a', bg: '#dbeafe' };
}

function parseKm(v: string): number | undefined {
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

export function GuardDispatchBoard() {
  const [date, setDate] = useState<string>(kstToday());
  const [items, setItems] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; title: string } | null>(null);

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

  const resolveUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : apiUrl(u || ''));

  return (
    <div className="content" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>🚗 배차 입·출차 현황 (경비실)</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => setDate(kstToday())} className="btn btn-sm">오늘</button>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" onClick={() => void load()} className="btn btn-sm">새로고침</button>
        </div>
      </div>
      <div style={{ color: '#475569', fontSize: 13 }}>
        차량 출차·입차 시 <b>시각</b>과 <b>적산거리(km)</b>를 확인해 입력하세요. 입차 시 적산거리를 입력하면 주행거리가 자동 계산됩니다.
      </div>

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
            <DispatchCard key={it.id} item={it} onSaved={load} onPhoto={(u, t) => setPhoto({ url: resolveUrl(u), title: t })} resolveUrl={resolveUrl} />
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

  const photos = [...(item.statusPhotos || []), ...(item.odometerPhotos || [])].filter((x) => x && x.url);
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
            운행예정 {fmtTime(item.startAt)}~{fmtTime(item.endAt)} · {item.destination} · {item.purpose}
          </div>
        </div>
        <span style={{ background: p.bg, color: p.color, borderRadius: 999, padding: '3px 12px', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>{p.label}</span>
      </div>

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

      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {photos.map((ph, i) => (
            <img
              key={i}
              src={resolveUrl(ph.url)}
              alt={ph.name || 'photo'}
              style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'pointer' }}
              onClick={() => onPhoto(ph.url || '', ph.name || '')}
            />
          ))}
        </div>
      )}
    </div>
  );
}
