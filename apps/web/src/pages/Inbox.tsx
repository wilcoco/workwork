import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

export function Inbox() {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/inbox?userId=${encodeURIComponent(userId)}&onlyUnread=false`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setItems(json.items || []);
    } catch (e: any) {
      setError(e.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: userId }) });
    await load();
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

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>인박스</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <input
          placeholder="내 User ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          style={{
            ...input,
            flex: isMobile ? '1 1 100%' : '0 0 auto',
            minWidth: isMobile ? '100%' : undefined,
          }}
        />
        <button onClick={load} disabled={!userId || loading} style={primaryBtn}>{loading ? '로딩...' : '불러오기'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((n) => (
          <div key={n.id} style={card}>
            <div><b>유형:</b> {n.type}</div>
            <div><b>대상:</b> {n.subjectType} / {n.subjectId}</div>
            <div><b>시간:</b> {formatKstDatetime(n.createdAt)}</div>
            <button onClick={() => markRead(n.id)} disabled={!!n.readAt} style={ghostBtn}>표시: 읽음</button>
          </div>
        ))}
        {!items.length && <div>알림 없음</div>}
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '6px 10px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#F8FAFC',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: 12,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.04)'
};
