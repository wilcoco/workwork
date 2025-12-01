import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { Link } from 'react-router-dom';

type UserLite = {
  id: string;
  email: string;
  name: string;
  role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL';
  orgUnitId: string;
  orgName: string;
};

export function AdminMembers() {
  const [items, setItems] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: UserLite[] }>('/api/users');
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onDelete(id: string) {
    if (!confirm('해당 구성원을 삭제할까요?')) return;
    try {
      await apiJson(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((u) => u.id !== id));
    } catch (e: any) {
      alert(e?.message || '삭제할 수 없습니다.');
    }
  }

  const filtered = items.filter((u) => {
    const t = (q || '').toLowerCase();
    if (!t) return true;
    return (
      u.name.toLowerCase().includes(t) ||
      u.email.toLowerCase().includes(t) ||
      (u.orgName || '').toLowerCase().includes(t) ||
      u.role.toLowerCase() === t
    );
  });

  return (
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '24px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2>구성원 관리</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link to="/admin/orgs" className="btn btn-ghost">조직관리</Link>
        </div>
      </div>

      <div className="card elevated accent" style={{ padding: 12, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <input
            placeholder="이름/이메일/조직/역할 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={input}
          />
          <button className="btn btn-ghost" onClick={load} disabled={loading}>{loading ? '새로고침…' : '새로고침'}</button>
        </div>
        {error && <div style={{ color: 'red' }}>{error}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>이름</th>
                <th style={{ textAlign: 'left' }}>이메일</th>
                <th style={{ textAlign: 'left' }}>역할</th>
                <th style={{ textAlign: 'left' }}>조직</th>
                <th style={{ textAlign: 'right' }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.orgName || '-'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-sm btn-danger" onClick={() => onDelete(u.id)}>삭제</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', color: '#6b7280' }}>구성원이 없습니다</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
