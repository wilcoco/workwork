import React, { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

function TreeNode({ node, onDelete, onSelect, selectedId }: { node: any; onDelete: (id: string) => void; onSelect: (id: string) => void; selectedId: string }) {
  return (
    <li>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => onSelect(node.id)} className={selectedId === node.id ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}>{selectedId === node.id ? '선택됨' : '선택'}</button>
        <strong>{node.name}</strong>
        <span style={{ fontSize: 12, color: '#6b7280' }}>({node.type})</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>child:{node.children?.length || 0} users:{node.counts?.users || 0} objs:{node.counts?.objectives || 0}</span>
        <button
          onClick={() => onDelete(node.id)}
          disabled={(node.children?.length || 0) > 0 || (node.counts?.users || 0) > 0 || (node.counts?.objectives || 0) > 0}
          title={(node.children?.length || 0) > 0 || (node.counts?.users || 0) > 0 || (node.counts?.objectives || 0) > 0 ? '자식/사용자/목표 해제 후 삭제 가능' : '삭제'}
          className="btn btn-danger btn-sm"
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

export function AdminOrgs(): JSX.Element {
  const [items, setItems] = useState<any[]>([]);
  const [flat, setFlat] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [objectives, setObjectives] = useState<any[]>([]);
  const [nukeWord, setNukeWord] = useState('');
  const [nuking, setNuking] = useState(false);

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

  }

  async function nukeAll(e: React.FormEvent) {
    e.preventDefault();
    if ((nukeWord || '').toLowerCase() !== 'delete everything') {
      setError("확인 문구로 'DELETE EVERYTHING' 을 입력해 주세요");
      return;
    }
    if (!confirm('정말 모든 조직/목표/KR/과제/업무일지를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    try {
      setNuking(true);
      await apiJson('/api/orgs/nuke', { method: 'POST', body: JSON.stringify({ confirm: nukeWord }) });
      setSelectedId('');
      setMembers([]);
      setObjectives([]);
      setNukeWord('');
      await load();
    } catch (e: any) {
      setError(e.message || '전체 삭제 실패');
    } finally {
      setNuking(false);
    }
  }

  async function loadObjectives(id: string) {
    try {
      const res = await apiJson<{ items: any[] }>(`/api/orgs/${encodeURIComponent(id)}/objectives`);
      setObjectives(res.items || []);
    } catch {
      setObjectives([]);
    }
  }
  async function loadMembers(id: string) {
    try {
      const res = await apiJson<{ items: any[] }>(`/api/orgs/${encodeURIComponent(id)}/members`);
      setMembers(res.items || []);
    } catch {
      setMembers([]);
    }
  }

  async function deleteObjective(oid: string) {
    if (!confirm('해당 목표를 삭제하시겠습니까?\n(키리절트/하위 목표가 없는 경우에만 삭제됩니다)')) return;
    try {
      await apiJson(`/api/okrs/objectives/${encodeURIComponent(oid)}`, { method: 'DELETE' });
      if (selectedId) {
        await loadObjectives(selectedId);
      }
    } catch (e: any) {
      setError(e.message || '목표 삭제 실패');
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
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 960, margin: '24px auto' }}>
      <h2 style={{ margin: 0 }}>조직 구성 관리</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div className="resp-2">
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>조직 트리</h3>
          {loading ? '로딩중…' : (
            <ul>
              {items.map((n) => (
                <TreeNode key={n.id} node={n} onDelete={onDelete} onSelect={onSelect} selectedId={selectedId} />
              ))}
            </ul>
          )}
        </div>
        <div className="card" style={{ padding: 12, display: 'grid', gap: 12 }}>
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
            <button className="btn btn-primary">생성</button>
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
                    <button onClick={() => removeMember(m.id)} className="btn btn-danger btn-sm">제거</button>
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
                  <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{o.title}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>기간: {new Date(o.periodStart).toLocaleDateString()} ~ {new Date(o.periodEnd).toLocaleDateString()} · 상태: {o.status}</div>
                    </div>
                    <button onClick={() => deleteObjective(o.id)} className="btn btn-danger btn-sm">삭제</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
            <h3 style={{ marginTop: 0, color: '#ef4444' }}>Danger Zone</h3>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              전체 삭제: 조직 트리, 목표, KR, 과제, 업무일지를 모두 삭제합니다. 복구 불가.
            </div>
            <form onSubmit={nukeAll} style={{ display: 'grid', gap: 8 }}>
              <input placeholder="DELETE EVERYTHING" value={nukeWord} onChange={(e) => setNukeWord(e.target.value)} style={input} />
              <button className="btn btn-danger" disabled={nuking}>{nuking ? '삭제중…' : '모두 삭제'}</button>
            </form>
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
