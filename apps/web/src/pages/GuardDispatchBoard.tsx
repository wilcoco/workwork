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
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
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

export function GuardDispatchBoard() {
  const [date, setDate] = useState<string>(kstToday());
  const [items, setItems] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<{ url: string; title: string } | null>(null);

  const actorId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';

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

  // 30초마다 자동 새로고침
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function doCheck(it: BoardItem, kind: 'checkout' | 'checkin') {
    const label = kind === 'checkout' ? '출차' : '입차';
    const ask = window.prompt(
      `${it.carName} (${it.carPlateNo || '번호미상'}) ${label} 처리\n적산거리(km)를 입력하세요. 모르면 비워두고 확인하세요.`,
      kind === 'checkin' && it.odometerEnd != null ? String(it.odometerEnd) : (kind === 'checkout' && it.odometerStart != null ? String(it.odometerStart) : ''),
    );
    if (ask === null) return; // cancelled
    const trimmed = ask.trim();
    const body: any = { actorId };
    if (trimmed !== '') {
      const n = parseInt(trimmed.replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(n)) body.odometer = n;
    }
    setBusyId(it.id);
    try {
      await apiJson(`/api/car-dispatch/${it.id}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      await load();
    } catch (e: any) {
      alert(e?.message || `${label} 처리에 실패했습니다`);
    } finally {
      setBusyId(null);
    }
  }

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

      {error && <div style={{ color: 'red' }}>{error}</div>}
      {loading ? (
        <div>불러오는 중…</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#64748b', padding: 24, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12 }}>
          해당 일자에 배차된 차량이 없습니다.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {items.map((it) => {
            const p = phase(it);
            const photos = [...(it.statusPhotos || []), ...(it.odometerPhotos || [])].filter((x) => x && x.url);
            return (
              <div key={it.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>
                      {it.carName} <span style={{ color: '#475569', fontWeight: 600 }}>{it.carPlateNo}</span>
                    </div>
                    <div style={{ fontSize: 13, color: '#334155', marginTop: 2 }}>
                      신청자 <b>{it.requesterName}</b>{it.coRiders ? ` · 동승 ${it.coRiders}` : ''}
                    </div>
                    <div style={{ fontSize: 13, color: '#334155' }}>
                      {fmtTime(it.startAt)}~{fmtTime(it.endAt)} · {it.destination} · {it.purpose}
                    </div>
                  </div>
                  <span style={{ background: p.bg, color: p.color, borderRadius: 999, padding: '3px 12px', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>{p.label}</span>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#475569' }}>
                  <span>출차 {fmtTime(it.checkoutAt)}{it.odometerStart != null ? ` (${it.odometerStart.toLocaleString()}km)` : ''}</span>
                  <span>입차 {fmtTime(it.checkinAt)}{it.odometerEnd != null ? ` (${it.odometerEnd.toLocaleString()}km)` : ''}</span>
                  <span style={{ fontWeight: 700, color: '#0f172a' }}>주행거리 {it.distanceKm != null ? `${it.distanceKm.toLocaleString()}km` : '-'}</span>
                </div>

                {photos.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {photos.map((ph, i) => (
                      <img
                        key={i}
                        src={resolveUrl(ph.url)}
                        alt={ph.name || 'photo'}
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'pointer' }}
                        onClick={() => setPhoto({ url: resolveUrl(ph.url), title: ph.name || '' })}
                      />
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busyId === it.id || !!it.checkoutAt}
                    onClick={() => void doCheck(it, 'checkout')}
                  >
                    {it.checkoutAt ? '출차 완료' : '출차 확인'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busyId === it.id || !it.checkoutAt || !!it.checkinAt}
                    onClick={() => void doCheck(it, 'checkin')}
                  >
                    {it.checkinAt ? '입차 완료' : '입차 확인'}
                  </button>
                </div>
              </div>
            );
          })}
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
