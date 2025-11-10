import { useEffect, useState } from 'react';
import { apiFetch, apiJson } from '../lib/api';

export function CoopsInbox() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
    if (uid) setUserId(uid);
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/inbox?userId=${encodeURIComponent(userId)}&onlyUnread=false`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setItems((json?.items || []).filter((n: any) => n.type === 'HelpRequested'));
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: userId }) });
    await load();
  }

  async function act(kind: 'accept' | 'start' | 'resolve' | 'decline', ticketId: string, notificationId?: string) {
    const body: any = { actorId: userId };
    if (kind === 'decline') body.reason = window.prompt('거절 사유를 입력하세요') || '';
    await apiJson(`/api/help-tickets/${ticketId}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
    if (notificationId) await markRead(notificationId);
    await load();
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>내 협조함</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <input placeholder="내 User ID" value={userId} onChange={(e) => setUserId(e.target.value)} style={input} />
        <button onClick={load} disabled={!userId || loading} style={primaryBtn}>{loading ? '로딩…' : '불러오기'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((n) => (
          <div key={n.id} style={card}>
            <div><b>티켓:</b> {n.payload?.ticketId}</div>
            <div><b>카테고리:</b> {n.payload?.category || '-'}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button onClick={() => act('accept', n.payload?.ticketId, n.id)} style={primaryBtn}>수락</button>
              <button onClick={() => act('start', n.payload?.ticketId)} style={ghostBtn}>시작</button>
              <button onClick={() => act('resolve', n.payload?.ticketId)} style={ghostBtn}>완료</button>
              <button onClick={() => act('decline', n.payload?.ticketId, n.id)} style={ghostBtn}>거절</button>
            </div>
          </div>
        ))}
        {!items.length && <div>내게 할당된 협조 없음</div>}
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
  padding: '10px 14px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 10,
  padding: 12,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.04)'
};
