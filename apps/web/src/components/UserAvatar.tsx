import { useMemo, useState, type CSSProperties } from 'react';
import { apiUrl } from '../lib/api';

export function UserAvatar({ userId, name, size, style, nonce }: { userId?: string | null; name?: string | null; size?: number; style?: CSSProperties; nonce?: string | number }) {
  const s = typeof size === 'number' && Number.isFinite(size) ? Math.max(12, Math.min(size, 160)) : 24;
  const [failed, setFailed] = useState(false);

  const src = useMemo(() => {
    const id = String(userId || '').trim();
    if (!id) return '';
    const base = apiUrl(`/api/users/${encodeURIComponent(id)}/photo`);
    const n = nonce != null ? String(nonce) : '';
    return n ? `${base}?v=${encodeURIComponent(n)}` : base;
  }, [nonce, userId]);

  const initial = String(name || '?').trim().slice(0, 1) || '?';

  if (!src || failed) {
    return (
      <div
        style={{
          width: s,
          height: s,
          borderRadius: 999,
          background: '#E2E8F0',
          display: 'grid',
          placeItems: 'center',
          fontSize: Math.max(10, Math.floor(s * 0.5)),
          fontWeight: 700,
          color: '#334155',
          flex: '0 0 auto',
          ...style,
        }}
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt="avatar"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{
        width: s,
        height: s,
        borderRadius: 999,
        objectFit: 'cover',
        background: '#E2E8F0',
        flex: '0 0 auto',
        ...style,
      }}
    />
  );
}
