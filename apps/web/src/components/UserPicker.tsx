import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

export type PickedUser = { id: string; name: string; email?: string; role?: string };

export function UserPicker({ onSelect, onClose }: { onSelect: (u: PickedUser) => void; onClose?: () => void }) {
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [members, setMembers] = useState<PickedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: { id: string; name: string }[] }>(`/api/orgs`);
        setOrgs(res.items || []);
      } catch (e: any) {
        setError(e?.message || '조직 목록 로드 실패');
      }
    })();
  }, []);

  async function loadMembers(id: string) {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: PickedUser[] }>(`/api/orgs/${id}/members`);
      setMembers(res.items || []);
    } catch (e: any) {
      setError(e?.message || '멤버 로드 실패');
    } finally {
      setLoading(false);
    }
  }

  const filtered = q
    ? members.filter((m) => (m.name || '').toLowerCase().includes(q.toLowerCase()) || (m.email || '').toLowerCase().includes(q.toLowerCase()) || m.id.includes(q))
    : members;

  return (
    <div style={wrap}>
      <div style={head}>
        <div style={{ fontWeight: 700 }}>사용자 선택</div>
        {onClose && (
          <button style={ghostBtn} onClick={onClose}>닫기</button>
        )}
      </div>
      {error && <div style={{ color: '#DC2626' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        <select value={orgId} onChange={(e) => { setOrgId(e.target.value); loadMembers(e.target.value); }} style={select}>
          <option value="">조직 선택</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <input placeholder="검색(이름/이메일/ID)" value={q} onChange={(e) => setQ(e.target.value)} style={input} />
        <div style={{ display: 'grid', gap: 6, maxHeight: 280, overflow: 'auto' }}>
          {loading ? <div>로딩…</div> : filtered.map((m) => (
            <button key={m.id} style={itemBtn} onClick={() => onSelect(m)}>
              <span style={{ fontWeight: 600 }}>{m.name}</span>
              <span style={{ color: '#64748b' }}> · {m.email || m.id}</span>
              <span style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 12 }}>{m.role || ''}</span>
            </button>
          ))}
          {!loading && !filtered.length && <div>멤버 없음</div>}
        </div>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  border: '1px solid #E5E7EB',
  borderRadius: 10,
  padding: 12,
  background: '#FFFFFF',
};
const head: React.CSSProperties = { display: 'flex', alignItems: 'center', marginBottom: 8 };
const input: React.CSSProperties = { border: '1px solid #CBD5E1', background: '#FFFFFF', borderRadius: 10, padding: '8px 10px', outline: 'none' };
const select: React.CSSProperties = { border: '1px solid #CBD5E1', background: '#FFFFFF', borderRadius: 10, padding: '8px 10px', outline: 'none' };
const ghostBtn: React.CSSProperties = { background: 'transparent', color: '#0F3D73', border: '1px solid #CBD5E1', borderRadius: 10, padding: '6px 10px', fontWeight: 600, marginLeft: 'auto' };
const itemBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, textAlign: 'left' as const, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 10, padding: '8px 10px' };
