import { useEffect, useMemo, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { uploadFiles } from '../lib/upload';

type Dispatch = {
  id: string;
  carName: string;
  carPlateNo: string;
  startAt: string;
  endAt: string;
  destination: string;
  purpose: string;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceKm: number | null;
  statusPhotos: Photo[];
  odometerPhotos: Photo[];
  usageNote: string;
  usageRegisteredAt: string | null;
};

type Photo = { url?: string; name?: string };

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function CarUsageReturn() {
  const userId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const [list, setList] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  const [statusPhotos, setStatusPhotos] = useState<Photo[]>([]);
  const [odometerPhotos, setOdometerPhotos] = useState<Photo[]>([]);
  const [odometerStart, setOdometerStart] = useState('');
  const [odometerEnd, setOdometerEnd] = useState('');
  const [usageNote, setUsageNote] = useState('');
  const [uploadingStatus, setUploadingStatus] = useState(false);
  const [uploadingOdo, setUploadingOdo] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMsg, setOcrMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    setStatusPhotos(selected.statusPhotos || []);
    setOdometerPhotos(selected.odometerPhotos || []);
    setOdometerStart(selected.odometerStart != null ? String(selected.odometerStart) : '');
    setOdometerEnd(selected.odometerEnd != null ? String(selected.odometerEnd) : '');
    setUsageNote(selected.usageNote || '');
    setOcrMsg('');
  }, [selectedId]);

  const resolveUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : apiUrl(u || ''));
  const uploadIdFromUrl = (u?: string) => {
    const m = String(u || '').match(/files\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };

  async function onPickStatus(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingStatus(true);
    try {
      const res = await uploadFiles(files);
      setStatusPhotos((prev) => [...prev, ...res.map((r) => ({ url: r.url, name: r.name }))]);
    } catch (e: any) {
      alert(e?.message || '사진 업로드에 실패했습니다');
    } finally {
      setUploadingStatus(false);
    }
  }

  async function onPickOdometer(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingOdo(true);
    try {
      const res = await uploadFiles(files);
      const added = res.map((r) => ({ url: r.url, name: r.name }));
      setOdometerPhotos((prev) => [...prev, ...added]);
      // 첫 번째 새 사진으로 자동 OCR
      const first = added[0];
      if (first?.url) await runOcr(first.url);
    } catch (e: any) {
      alert(e?.message || '사진 업로드에 실패했습니다');
    } finally {
      setUploadingOdo(false);
    }
  }

  async function runOcr(url: string) {
    const uploadId = uploadIdFromUrl(url);
    if (!uploadId) return;
    setOcrBusy(true);
    setOcrMsg('계기판 사진에서 적산거리를 읽는 중…');
    try {
      const res = await apiJson<{ odometerKm: number | null; confidence: string; rawText: string }>(
        `/api/car-dispatch/ocr-odometer`,
        { method: 'POST', body: JSON.stringify({ uploadId }) },
      );
      if (res.odometerKm != null) {
        setOdometerEnd(String(res.odometerKm));
        setOcrMsg(`인식된 적산거리: ${res.odometerKm.toLocaleString()}km (신뢰도 ${res.confidence}). 값을 확인하고 필요하면 수정하세요.`);
      } else {
        setOcrMsg('숫자를 자동으로 읽지 못했습니다. 직접 입력해 주세요.');
      }
    } catch (e: any) {
      setOcrMsg(`자동 인식 실패: ${e?.message || ''} — 직접 입력해 주세요.`);
    } finally {
      setOcrBusy(false);
    }
  }

  function removeStatusPhoto(i: number) {
    setStatusPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }
  function removeOdometerPhoto(i: number) {
    setOdometerPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  const distancePreview = useMemo(() => {
    const s = parseInt(odometerStart.replace(/[^0-9]/g, ''), 10);
    const e = parseInt(odometerEnd.replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) return e - s;
    return null;
  }, [odometerStart, odometerEnd]);

  async function onSubmit() {
    if (!selected) { alert('차량 사용 건을 선택하세요'); return; }
    if (statusPhotos.length === 0 && odometerPhotos.length === 0) {
      if (!window.confirm('사진 없이 등록할까요?')) return;
    }
    const body: any = {
      actorId: userId,
      statusPhotos,
      odometerPhotos,
      usageNote,
    };
    const s = parseInt(odometerStart.replace(/[^0-9]/g, ''), 10);
    const e = parseInt(odometerEnd.replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(s)) body.odometerStart = s;
    if (Number.isFinite(e)) body.odometerEnd = e;

    setSubmitting(true);
    try {
      await apiJson(`/api/car-dispatch/${selected.id}/register-usage`, { method: 'POST', body: JSON.stringify(body) });
      alert('차량 사용 후 등록이 완료되었습니다');
      await load();
    } catch (e: any) {
      alert(e?.message || '등록에 실패했습니다');
    } finally {
      setSubmitting(false);
    }
  }

  const card: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' };

  return (
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <h2 style={{ margin: 0 }}>법인차량 사용 후 등록</h2>
      <div style={{ color: '#475569', fontSize: 13 }}>
        차량 반납 시 <b>차량 상태 사진</b>과 <b>계기판(적산거리) 사진</b>을 등록합니다. 계기판 사진을 올리면 적산거리(km)를 자동으로 읽어 드립니다.
      </div>

      <div style={card}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontWeight: 700 }}>사용한 차량 (내 승인된 배차)</span>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">{loading ? '불러오는 중…' : '선택하세요'}</option>
            {list.map((d) => (
              <option key={d.id} value={d.id}>
                {fmt(d.startAt)} · {d.carName}{d.carPlateNo ? ` (${d.carPlateNo})` : ''} · {d.destination}
                {d.usageRegisteredAt ? ' · [등록됨]' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected && (
        <>
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>차량 상태 사진</div>
            <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => void onPickStatus(e.target.files)} />
            {uploadingStatus && <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>업로드 중…</div>}
            {statusPhotos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {statusPhotos.map((ph, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={resolveUrl(ph.url)} alt={ph.name} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} />
                    <button type="button" onClick={() => removeStatusPhoto(i)} style={delBtn}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>계기판(적산거리) 사진</div>
            <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => void onPickOdometer(e.target.files)} />
            {uploadingOdo && <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>업로드 중…</div>}
            {odometerPhotos.length > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {odometerPhotos.map((ph, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={resolveUrl(ph.url)} alt={ph.name} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' }} />
                    <button type="button" onClick={() => removeOdometerPhoto(i)} style={delBtn}>×</button>
                    <button type="button" onClick={() => void runOcr(ph.url || '')} style={{ ...delBtn, top: 'auto', bottom: -6, right: 'auto', left: -6, background: '#0f3d73', width: 'auto', borderRadius: 8, padding: '0 6px', fontSize: 11 }}>읽기</button>
                  </div>
                ))}
              </div>
            )}
            {(ocrBusy || ocrMsg) && (
              <div style={{ fontSize: 13, color: ocrBusy ? '#64748b' : '#0f172a', marginTop: 8 }}>{ocrBusy ? '계기판 사진에서 적산거리를 읽는 중…' : ocrMsg}</div>
            )}
          </div>

          <div style={card}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={{ display: 'grid', gap: 4, flex: 1, minWidth: 140 }}>
                  <span>출발 적산거리(km) <span style={{ color: '#94a3b8' }}>(선택)</span></span>
                  <input inputMode="numeric" value={odometerStart} onChange={(e) => setOdometerStart(e.target.value)} placeholder="예: 45120" />
                </label>
                <label style={{ display: 'grid', gap: 4, flex: 1, minWidth: 140 }}>
                  <span>복귀 적산거리(km)</span>
                  <input inputMode="numeric" value={odometerEnd} onChange={(e) => setOdometerEnd(e.target.value)} placeholder="계기판 사진에서 자동 추출" />
                </label>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: distancePreview != null ? '#0f172a' : '#94a3b8' }}>
                주행거리: {distancePreview != null ? `${distancePreview.toLocaleString()}km` : '출발·복귀 적산거리 입력 시 자동 계산'}
              </div>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>특이사항 <span style={{ color: '#94a3b8' }}>(선택)</span></span>
                <textarea value={usageNote} onChange={(e) => setUsageNote(e.target.value)} rows={3} placeholder="외관 손상, 주유, 사고 등 특이사항" />
              </label>
            </div>
          </div>

          <div>
            <button type="button" className="btn" disabled={submitting} onClick={() => void onSubmit()}>
              {submitting ? '등록 중…' : '사용 후 등록'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const delBtn: React.CSSProperties = {
  position: 'absolute',
  top: -6,
  right: -6,
  width: 20,
  height: 20,
  borderRadius: 10,
  border: 'none',
  background: '#ef4444',
  color: '#fff',
  cursor: 'pointer',
  lineHeight: '18px',
  fontSize: 13,
  padding: 0,
};
