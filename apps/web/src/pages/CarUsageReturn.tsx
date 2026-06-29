import { useEffect, useMemo, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { uploadPhotosDisk } from '../lib/upload';

type Photo = { url?: string; name?: string };

type Dispatch = {
  id: string;
  carId: string;
  carName: string;
  carType?: string;
  carPlateNo: string;
  startAt: string;
  endAt: string;
  destination: string;
  purpose: string;
  status: string;
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

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const resolveUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : apiUrl(u || ''));
const uploadIdFromUrl = (u?: string) => {
  const m = String(u || '').match(/files\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
};

const delBtn: React.CSSProperties = {
  position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
  border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer',
  lineHeight: '18px', fontSize: 13, padding: 0,
};

function PhotoUploader({
  photos,
  setPhotos,
  onAdded,
  onPreview,
}: {
  photos: Photo[];
  setPhotos: (updater: (prev: Photo[]) => Photo[]) => void;
  onAdded?: (added: Photo[]) => void;
  onPreview: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  async function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const res = await uploadPhotosDisk(files);
      const added = res.map((r) => ({ url: r.url, name: r.name }));
      setPhotos((prev) => [...prev, ...added]);
      onAdded?.(added);
    } catch (e: any) {
      alert(e?.message || '사진 업로드에 실패했습니다');
    } finally {
      setUploading(false);
    }
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          📷 카메라 촬영
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => void pick(e.target.files)} />
        </label>
        <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          🖼 사진함에서 선택
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => void pick(e.target.files)} />
        </label>
      </div>
      {uploading && <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>업로드 중…</div>}
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {photos.map((ph, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={resolveUrl(ph.url)}
                alt={ph.name}
                style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb', cursor: 'pointer' }}
                onClick={() => onPreview(resolveUrl(ph.url))}
              />
              <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))} style={delBtn}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CarUsageReturn() {
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [list, setList] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  const [statusBefore, setStatusBefore] = useState<Photo[]>([]);
  const [statusAfter, setStatusAfter] = useState<Photo[]>([]);
  const [odoPhotosBefore, setOdoPhotosBefore] = useState<Photo[]>([]);
  const [odoPhotosAfter, setOdoPhotosAfter] = useState<Photo[]>([]);
  const [odoBefore, setOdoBefore] = useState('');
  const [odoAfter, setOdoAfter] = useState('');
  const [usageNote, setUsageNote] = useState('');
  const [ocrBusy, setOcrBusy] = useState<'before' | 'after' | null>(null);
  const [ocrMsg, setOcrMsg] = useState<{ before?: string; after?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [carLast, setCarLast] = useState<{ odometer: number | null; at: string | null; source: string | null } | null>(null);

  const selected = useMemo(() => list.find((d) => d.id === selectedId) || null, [list, selectedId]);

  async function load() {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await apiJson<{ items: Dispatch[] }>(`/api/car-dispatch/my-usage?requesterId=${encodeURIComponent(userId)}`);
      setList(res.items || []);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [userId]);

  // 선택 변경 시 기존 등록 내용 프리필
  useEffect(() => {
    if (!selected) return;
    setStatusBefore(selected.statusPhotosBefore || []);
    setStatusAfter(selected.statusPhotosAfter || []);
    setOdoPhotosBefore(selected.odometerPhotosBefore || []);
    setOdoPhotosAfter(selected.odometerPhotosAfter || []);
    setOdoBefore(selected.odometerBeforeOcr != null ? String(selected.odometerBeforeOcr) : '');
    setOdoAfter(selected.odometerAfterOcr != null ? String(selected.odometerAfterOcr) : '');
    setUsageNote(selected.usageNote || '');
    setOcrMsg({});
    // 이 차량의 직전(다른 배차) 최근 키로수 참고값 조회
    setCarLast(null);
    (async () => {
      try {
        const r = await apiJson<{ odometer: number | null; at: string | null; source: string | null }>(
          `/api/car-dispatch/last-odometer?carId=${encodeURIComponent(selected.carId)}&excludeId=${encodeURIComponent(selected.id)}`,
        );
        setCarLast(r);
      } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function runOcr(url: string, which: 'before' | 'after') {
    if (!url) return;
    const uploadId = uploadIdFromUrl(url); // 구 DB 업로드 호환
    setOcrBusy(which);
    setOcrMsg((m) => ({ ...m, [which]: '계기판 사진에서 적산거리를 읽는 중…' }));
    try {
      const res = await apiJson<{ odometerKm: number | null; confidence: string }>(
        `/api/car-dispatch/ocr-odometer`,
        { method: 'POST', body: JSON.stringify({ url, uploadId: uploadId || undefined }) },
      );
      if (res.odometerKm != null) {
        if (which === 'before') setOdoBefore(String(res.odometerKm));
        else setOdoAfter(String(res.odometerKm));
        setOcrMsg((m) => ({ ...m, [which]: `인식된 적산거리: ${res.odometerKm!.toLocaleString()}km (신뢰도 ${res.confidence}). 확인 후 필요하면 수정하세요.` }));
      } else {
        setOcrMsg((m) => ({ ...m, [which]: '숫자를 자동으로 읽지 못했습니다. 직접 입력해 주세요.' }));
      }
    } catch (e: any) {
      setOcrMsg((m) => ({ ...m, [which]: `자동 인식 실패: ${e?.message || ''} — 직접 입력해 주세요.` }));
    } finally {
      setOcrBusy(null);
    }
  }

  const distancePreview = useMemo(() => {
    const s = parseInt(odoBefore.replace(/[^0-9]/g, ''), 10);
    const e = parseInt(odoAfter.replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) return e - s;
    return null;
  }, [odoBefore, odoAfter]);

  async function onSubmit() {
    if (!selected) { alert('차량 사용 건을 선택하세요'); return; }
    const noPhotos = statusBefore.length + statusAfter.length + odoPhotosBefore.length + odoPhotosAfter.length === 0;
    if (noPhotos && !window.confirm('사진 없이 등록할까요?')) return;

    const body: any = {
      actorId: userId,
      statusPhotosBefore: statusBefore,
      statusPhotosAfter: statusAfter,
      odometerPhotosBefore: odoPhotosBefore,
      odometerPhotosAfter: odoPhotosAfter,
      usageNote,
    };
    const b = parseInt(odoBefore.replace(/[^0-9]/g, ''), 10);
    const a = parseInt(odoAfter.replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(b)) body.odometerBeforeOcr = b;
    if (Number.isFinite(a)) body.odometerAfterOcr = a;

    setSubmitting(true);
    try {
      await apiJson(`/api/car-dispatch/${selected.id}/register-usage`, { method: 'POST', body: JSON.stringify(body) });
      alert('차량 사용 전후 등록이 완료되었습니다');
      await load();
    } catch (e: any) {
      alert(e?.message || '등록에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  }

  const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' };
  const sub: React.CSSProperties = { border: '1px solid #f1f5f9', borderRadius: 10, padding: 12, background: '#f8fafc' };

  return (
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      <h2 style={{ margin: 0 }}>법인차량 사용 전후 등록</h2>
      <div style={{ color: '#475569', fontSize: 13 }}>
        차량 사용 <b>전</b>과 <b>후</b> 각각 <b>차량 상태 사진</b>과 <b>계기판(적산거리) 사진</b>을 등록합니다. 계기판 사진을 올리면 적산거리(km)를 자동으로 읽어 드립니다.
      </div>
      <div style={{ fontSize: 11, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px' }}>
        ⚠ 차량/계기판 사진만 올리세요. 민감·기밀 자료는 금지(사진은 외부 서버 저장). 내부 문서는 원드라이브를 이용하세요.
      </div>

      <div style={card}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 700 }}>사용한 차량 (내 승인된 배차)</span>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">{loading ? '불러오는 중…' : '선택하세요'}</option>
            {list.map((d) => (
              <option key={d.id} value={d.id}>
                {fmt(d.startAt)} · {d.carName}{d.carType ? ` (${d.carType})` : ''}{d.carPlateNo ? ` ${d.carPlateNo}` : ''} · {d.destination}
                {d.status === 'PENDING' ? ' · [결재전]' : ''}
                {d.usageRegisteredAt ? ' · [등록됨]' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected && carLast?.odometer != null && (
        <div style={{ fontSize: 13, color: '#0369a1', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '8px 12px' }}>
          📌 이 차량 현재 누적거리(인증 기준): <b>{carLast.odometer.toLocaleString()}km</b>
          {carLast.at ? ` (${fmt(carLast.at)}${carLast.source ? `, ${carLast.source}` : ''})` : ''} — 사용 전 적산거리 입력 시 참고하세요.
        </div>
      )}

      {selected && (
        <>
          {/* 사용 전 */}
          <div style={{ ...card, borderTop: '4px solid #2563eb' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>🅰 사용 전</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={sub}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>차량 상태 사진 (사용 전)</div>
                <PhotoUploader photos={statusBefore} setPhotos={setStatusBefore} onPreview={(u) => setPreview(u)} />
              </div>
              <div style={sub}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>계기판 사진 (사용 전)</div>
                <PhotoUploader
                  photos={odoPhotosBefore}
                  setPhotos={setOdoPhotosBefore}
                  onPreview={(u) => setPreview(u)}
                  onAdded={(added) => { if (added[0]?.url) void runOcr(added[0].url, 'before'); }}
                />
                <label style={{ display: 'grid', gap: 4, marginTop: 10, maxWidth: 240 }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>사용 전 적산거리(km)</span>
                  <input inputMode="numeric" value={odoBefore} onChange={(e) => setOdoBefore(e.target.value)} placeholder="계기판 사진에서 자동 추출" />
                </label>
                {(ocrBusy === 'before' || ocrMsg.before) && (
                  <div style={{ fontSize: 13, color: ocrBusy === 'before' ? '#64748b' : '#0f172a', marginTop: 6 }}>
                    {ocrBusy === 'before' ? '계기판 사진에서 적산거리를 읽는 중…' : ocrMsg.before}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 사용 후 */}
          <div style={{ ...card, borderTop: '4px solid #16a34a' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>🅱 사용 후</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={sub}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>차량 상태 사진 (사용 후)</div>
                <PhotoUploader photos={statusAfter} setPhotos={setStatusAfter} onPreview={(u) => setPreview(u)} />
              </div>
              <div style={sub}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>계기판 사진 (사용 후)</div>
                <PhotoUploader
                  photos={odoPhotosAfter}
                  setPhotos={setOdoPhotosAfter}
                  onPreview={(u) => setPreview(u)}
                  onAdded={(added) => { if (added[0]?.url) void runOcr(added[0].url, 'after'); }}
                />
                <label style={{ display: 'grid', gap: 4, marginTop: 10, maxWidth: 240 }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>사용 후 적산거리(km)</span>
                  <input inputMode="numeric" value={odoAfter} onChange={(e) => setOdoAfter(e.target.value)} placeholder="계기판 사진에서 자동 추출" />
                </label>
                {(ocrBusy === 'after' || ocrMsg.after) && (
                  <div style={{ fontSize: 13, color: ocrBusy === 'after' ? '#64748b' : '#0f172a', marginTop: 6 }}>
                    {ocrBusy === 'after' ? '계기판 사진에서 적산거리를 읽는 중…' : ocrMsg.after}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={card}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: distancePreview != null ? '#0f172a' : '#94a3b8' }}>
                주행거리: {distancePreview != null ? `${distancePreview.toLocaleString()}km` : '사용 전·후 적산거리 입력 시 자동 계산'}
              </div>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>특이사항 <span style={{ color: '#94a3b8' }}>(선택)</span></span>
                <textarea value={usageNote} onChange={(e) => setUsageNote(e.target.value)} rows={3} placeholder="외관 손상, 주유, 사고 등 특이사항" />
              </label>
            </div>
          </div>

          <div>
            <button type="button" className="btn" disabled={submitting} onClick={() => void onSubmit()}>
              {submitting ? '등록 중…' : '사용 전후 등록'}
            </button>
          </div>
        </>
      )}

      {preview && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000, padding: 16 }}
          onClick={() => setPreview(null)}
        >
          <img src={preview} alt="" style={{ maxWidth: '95%', maxHeight: '95%', borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}
