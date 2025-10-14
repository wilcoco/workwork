import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export function Inbox() {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // noop
  }, []);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>인박스</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <input placeholder="내 User ID" value={userId} onChange={(e) => setUserId(e.target.value)} />
        <button onClick={load} disabled={!userId || loading}>{loading ? '로딩...' : '불러오기'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((n) => (
          <div key={n.id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, background: n.readAt ? '#fafafa' : 'white' }}>
            <div><b>유형:</b> {n.type}</div>
            <div><b>대상:</b> {n.subjectType} / {n.subjectId}</div>
            <div><b>시간:</b> {n.createdAt}</div>
            <button onClick={() => markRead(n.id)} disabled={!!n.readAt}>표시: 읽음</button>
          </div>
        ))}
        {!items.length && <div>알림 없음</div>}
      </div>
    </div>
  );
}
