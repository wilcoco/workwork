import { useState } from 'react';
import { uploadPhotosDisk } from '../lib/upload';

// 모바일 카메라 촬영/사진 업로드 → Railway 볼륨(디스크) 저장.
// 사진(외부·비민감)용. 내부 문서는 원드라이브 사용.
export function MobilePhotoButton({
  onUploaded,
  label,
  style,
}: {
  onUploaded: (files: Array<{ url: string; name?: string }>) => void;
  label?: string;
  style?: React.CSSProperties;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="btn btn-sm btn-ghost" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, ...style }}>
      📷 {busy ? '업로드 중…' : (label || '사진 촬영/업로드')}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        disabled={busy}
        style={{ display: 'none' }}
        onChange={async (e) => {
          const fs = e.target.files;
          if (!fs || !fs.length) return;
          setBusy(true);
          try {
            const res = await uploadPhotosDisk(fs);
            onUploaded(res.map((r) => ({ url: r.url, name: r.name })));
          } catch (err: any) {
            alert(err?.message || '사진 업로드 실패');
          } finally {
            setBusy(false);
            try { (e.target as HTMLInputElement).value = ''; } catch {}
          }
        }}
      />
    </label>
  );
}
