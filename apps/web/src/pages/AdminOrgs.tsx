import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

function TreeNode({ node, onDelete, onSelect, selectedId }: { node: any; onDelete: (id: string) => void; onSelect: (id: string) => void; selectedId: string }) {
  return (
    <li>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => onSelect(node.id)} style={{ background: selectedId === node.id ? '#0F3D73' : '#fff', color: selectedId === node.id ? '#fff' : '#0F3D73', border: '1px solid #0F3D73', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>{selectedId === node.id ? '선택됨' : '선택'}</button>
        <strong>{node.name}</strong>
        <span style={{ fontSize: 12, color: '#6b7280' }}>({node.type})</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>child:{node.children?.length || 0} users:{node.counts?.users || 0} objs:{node.counts?.objectives || 0}</span>
        <button
          onClick={() => onDelete(node.id)}
          disabled={(node.children?.length || 0) > 0 || (node.counts?.users || 0) > 0 || (node.counts?.objectives || 0) > 0}
          title={(node.children?.length || 0) > 0 || (node.counts?.users || 0) > 0 || (node.counts?.objectives || 0) > 0 ? '자식/사용자/목표 해제 후 삭제 가능' : '삭제'}
          style={{ marginLeft: 8, background: '#fff', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, padding: '2px 6px', cursor: 'pointer' }}
        >
          삭제
        </button>
      </div>
      {node.children && node.children.length > 0 && (
        <ul>
          {node.children.map((c: any) => (
            <TreeNode key={c.id} node={c} onDelete={onDelete} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AdminOrgs() {
  const [items, setItems] = useState<any[]>([]);
  const [flat, setFlat] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [objectives, setObjectives] = useState<any[]>([]);

  const [name, setName] = useState('');
  const [type, setType] = useState('TEAM');
  const [parentId, setParentId] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const tree = await apiJson<{ items: any[] }>(`/api/orgs/tree`);
      const list = await apiJson<{ items: any[] }>(`/api/orgs`);
      setItems(tree.items || []);
      setFlat(list.items || []);
    } catch (e: any) {
      setError(e.message || '로드 실패');
    } finally {
      setLoading(false);
    }

  async function loadObjectives(id: string) {
    try {
      const res = await apiJson<{ items: any[] }>(`/api/orgs/${encodeURIComponent(id)}/objectives`);
      setObjectives(res.items || []);
    } catch {
      setObjectives([]);
    }

  async function loadMembers(id: string) {
    try {
      const res = await apiJson<{ items: any[] }>(`/api/orgs/${encodeURIComponent(id)}/members`);
      setMembers(res.items || []);
    } catch {
      setMembers([]);
    }
  }

  function onSelect(id: string) {
    setSelectedId(id);
    loadMembers(id);
    loadObjectives(id);
  }

  async function removeMember(uid: string) {
    if (!selectedId) return;
    if (!confirm('해당 구성원을 이 조직에서 제거하시겠습니까?')) return;
    try {
      await apiJson(`/api/orgs/${encodeURIComponent(selectedId)}/members/${encodeURIComponent(uid)}`, { method: 'DELETE' });
      await loadMembers(selectedId);
      await load();
    } catch (e: any) {
      setError(e.message || '구성원 제거 실패');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createOrg(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiJson(`/api/orgs`, { method: 'POST', body: JSON.stringify({ name, type, parentId: parentId || undefined }) });
      setName('');
      setType('TEAM');
      setParentId('');
      await load();
    } catch (e: any) {
      setError(e.message || '생성 실패');
    }
  }

  async function onDelete(id: string) {
    if (!confirm('정말 삭제하시겠습니까?\n자식 조직과 사용자 연결이 없는 경우에만 삭제됩니다.')) return;
    try {
      await apiJson(`/api/orgs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await load();
    } catch (e: any) {
      setError(e.message || '삭제 실패');
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', display: 'grid', gap: 16 }}>
      <h2 style={{ margin: 0 }}>조직 구성 관리</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>조직 트리</h3>
          {loading ? '로딩중…' : (
            <ul>
              {items.map((n) => (
                <TreeNode key={n.id} node={n} onDelete={onDelete} onSelect={onSelect} selectedId={selectedId} />
              ))}
            </ul>
          )}
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, display: 'grid', gap: 12 }}>
          <h3 style={{ marginTop: 0 }}>조직 추가</h3>
          <form onSubmit={createOrg} style={{ display: 'grid', gap: 8 }}>
            <input placeholder="조직명" value={name} onChange={(e) => setName(e.target.value)} required style={input} />
            <select value={type} onChange={(e) => setType(e.target.value)} style={input}>
              <option value="COMPANY">COMPANY</option>
              <option value="DIVISION">DIVISION</option>
              <option value="TEAM">TEAM</option>
            </select>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} style={input}>
              <option value="">(상위 없음)</option>
              {flat.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.type})</option>
              ))}
            </select>
            <button className="btn">생성</button>
          </form>
          <div>
            <h3 style={{ marginTop: 0 }}>구성원</h3>
            {!selectedId && <div style={{ color: '#6b7280', fontSize: 13 }}>왼쪽 트리에서 조직을 선택하세요.</div>}
            {selectedId && (
              <div style={{ display: 'grid', gap: 6 }}>
                {members.length === 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>구성원이 없습니다.</div>}
                {members.map((m) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{m.email} · {m.role}</div>
                    </div>
                    <button onClick={() => removeMember(m.id)} style={{ background: '#fff', color: '#ef4444', border: '1px solid #ef4444', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' }}>제거</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>목표(Objectives)</h3>
            {!selectedId && <div style={{ color: '#6b7280', fontSize: 13 }}>왼쪽 트리에서 조직을 선택하세요.</div>}
            {selectedId && (
              <div style={{ display: 'grid', gap: 6 }}>
                {objectives.length === 0 && <div style={{ color: '#6b7280', fontSize: 13 }}>목표가 없습니다.</div>}
                {objectives.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>팀을 삭제하려면 이 팀에 속한 목표를 먼저 다른 조직으로 이동하거나 삭제해야 합니다.</div>
                )}
                {objectives.map((o) => (
                  <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                    <div style={{ fontWeight: 600 }}>{o.title}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>기간: {new Date(o.periodStart).toLocaleDateString()} ~ {new Date(o.periodEnd).toLocaleDateString()} · 상태: {o.status}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
