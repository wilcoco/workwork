import { useEffect, useRef, useState } from 'react';
import { apiJson } from '../lib/api';

export type PickedUser = { id: string; name: string; email?: string; role?: string; orgName?: string };

export function UserPicker({ onSelect, onClose }: { onSelect: (u: PickedUser) => void; onClose?: () => void }) {
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState<string>('');
  const [members, setMembers] = useState<PickedUser[]>([]);
  const [allResults, setAllResults] = useState<PickedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [orgsRes, allRes] = await Promise.all([
          apiJson<{ items: { id: string; name: string }[] }>(`/api/orgs`),
          apiJson<{ items: PickedUser[] }>(`/api/orgs/members/all`),
        ]);
        setOrgs(orgsRes.items || []);
        setAllResults(allRes.items || []);
      } catch (e: any) {
        setError(e?.message || '목록 로드 실패');
      }
    })();
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!orgId) {
      searchTimer.current = setTimeout(async () => {
        setLoading(true);
        try {
          const res = await apiJson<{ items: PickedUser[] }>(`/api/orgs/members/all${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
          setAllResults(res.items || []);
        } catch {} finally {
          setLoading(false);
        }
      }, 200);
    }
  }, [q, orgId]);

  async function loadMembers(id: string) {
    if (!id) { setMembers([]); return; }
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

  const filtered = orgId
    ? (q ? members.filter((m) => (m.name || '').includes(q) || (m.email || '').includes(q)) : members)
    : allResults;

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
        <input
          placeholder="이름 직접 입력으로 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...input, fontWeight: q ? 600 : undefined }}
          autoFocus
        />
        <select value={orgId} onChange={(e) => { setOrgId(e.target.value); loadMembers(e.target.value); }} style={select}>
          <option value="">조직으로 필터(선택)</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <div style={{ display: 'grid', gap: 6, maxHeight: 280, overflow: 'auto' }}>
          {loading ? <div>로딩…</div> : filtered.map((m) => (
            <div key={m.id} style={itemRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{m.name}</span>
                {m.orgName && <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 6 }}>{m.orgName}</span>}
                <div style={{ color: '#64748b', fontSize: 12 }}>{m.email || m.id}</div>
              </div>
              <button type="button" style={selectBtn} onClick={() => onSelect(m)}>선택</button>
            </div>
          ))}
          {!loading && !filtered.length && <div style={{ color: '#94a3b8', fontSize: 13 }}>검색 결과 없음</div>}
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
const itemRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 10, padding: '8px 10px' };
const selectBtn: React.CSSProperties = { marginLeft: 'auto', background: '#0F3D73', color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '4px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 };
