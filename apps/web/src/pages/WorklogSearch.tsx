import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

type Item = {
  id: string;
  date: string;
  title: string;
  excerpt: string;
  userName?: string;
  teamName?: string;
  taskName?: string;
};

// NOTE: Trigger redeploy - adding non-functional comments.
// This page renders SNS-like cards for worklog search results.
// No functional changes in this commit.

export function WorklogSearch() {
  const [team, setTeam] = useState('');
  const [user, setUser] = useState('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('teamName');
    if (t) setTeam(t);
  }, []);

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (team) params.set('team', team);
      if (user) params.set('user', user);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (q) params.set('q', q);
      const res = await apiJson<{ items: Item[] }>(`/api/worklogs/search?${params.toString()}`);
      setItems(res.items);
    } catch (e) {
      setError('조회 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gap: 8, background: '#fff', border: '1px solid #eee', padding: 12, borderRadius: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          <input placeholder="팀명" value={team} onChange={(e) => setTeam(e.target.value)} style={input} />
          <input placeholder="이름" value={user} onChange={(e) => setUser(e.target.value)} style={input} />
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={input} />
          <input placeholder="검색어" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button style={primaryBtn} onClick={search} disabled={loading}>{loading ? '검색중…' : '검색'}</button>
        </div>
      </div>

      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {items.map((it) => (
          <div key={it.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
              <div style={avatar}>{(it.userName || '?').slice(0, 1)}</div>
              <div>{it.userName}</div>
              <div>·</div>
              <div>{it.teamName}</div>
              <div style={{ marginLeft: 'auto' }}>{new Date(it.date).toLocaleString()}</div>
            </div>
            <div style={{ marginTop: 6, fontWeight: 700 }}>{it.title}</div>
            <div style={{ marginTop: 6, color: '#374151' }}>{it.excerpt}</div>
            {it.taskName && <div style={{ marginTop: 8, fontSize: 12, color: '#111827', background: '#f3f4f6', display: 'inline-block', padding: '4px 8px', borderRadius: 999 }}>{it.taskName}</div>}
            <div style={{ marginTop: 10 }}>
              <Link to={`/worklogs/${it.id}`} style={{ color: '#2563eb', fontWeight: 600 }}>자세히 보기</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  background: '#fff',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#111827',
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #eee',
  borderRadius: 12,
  padding: 14,
  boxShadow: '0 2px 10px rgba(0,0,0,0.04)'
};

const avatar: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 999,
  background: '#e5e7eb',
  display: 'grid',
  placeItems: 'center',
  fontSize: 12,
  fontWeight: 700,
};
