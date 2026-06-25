import { useState } from 'react';
import { uploadPhotosDisk } from '../lib/upload';

// 모바일 카메라/사진함 → Railway 볼륨(디스크) 저장.
// 사진(외부·비민감)용. 내부 민감/기밀 문서는 원드라이브 사용.
export function MobilePhotoButton({
  onUploaded,
  warn = true,
  style,
}: {
  onUploaded: (files: Array<{ url: string; name?: string }>) => void;
  warn?: boolean;
  style?: React.CSSProperties;
}) {
  const [busy, setBusy] = useState(false);

  async function handle(fs: FileList | null, ev: HTMLInputElement) {
    if (!fs || !fs.length) return;
    setBusy(true);
    try {
      const res = await uploadPhotosDisk(fs);
      onUploaded(res.map((r) => ({ url: r.url, name: r.name })));
    } catch (err: any) {
      alert(err?.message || '사진 업로드 실패');
    } finally {
      setBusy(false);
      try { ev.value = ''; } catch {}
    }
  }

  const btn: React.CSSProperties = { cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 };

  return (
    <div style={{ display: 'grid', gap: 5, ...style }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {/* 카메라 촬영 (모바일에서 카메라 바로 실행) */}
        <label className="btn btn-sm btn-ghost" style={btn}>
          📷 카메라 촬영
          <input type="file" accept="image/*" capture="environment" disabled={busy} style={{ display: 'none' }}
            onChange={(e) => void handle(e.target.files, e.target)} />
        </label>
        {/* 사진함(갤러리) 선택 */}
        <label className="btn btn-sm btn-ghost" style={btn}>
          🖼 사진함에서 선택
          <input type="file" accept="image/*" multiple disabled={busy} style={{ display: 'none' }}
            onChange={(e) => void handle(e.target.files, e.target)} />
        </label>
        {busy && <span style={{ fontSize: 12, color: '#64748b', alignSelf: 'center' }}>업로드 중…</span>}
      </div>
      {warn && (
        <div style={{ fontSize: 11, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 8px' }}>
          ⚠ 민감·기밀 자료는 올리지 마세요. 내부 문서는 <b>원드라이브</b>를 이용하세요. (사진은 외부 서버에 저장됩니다)
        </div>
      )}
    </div>
  );
}
