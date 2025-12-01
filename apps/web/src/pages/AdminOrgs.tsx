import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE, apiJson } from '../lib/api';

function TreeNode({ node, onDelete, onForceDelete, onSelect, selectedId }: { node: any; onDelete: (id: string) => void; onForceDelete: (id: string) => void; onSelect: (id: string) => void; selectedId: string }) {
  const childCnt = node.children?.length || 0;
  const userCnt = node.counts?.users || 0;
  const objCnt = node.counts?.objectives || 0;
  const deleteBlocked = childCnt > 0 || userCnt > 0 || objCnt > 0;
  const deleteReason = deleteBlocked ? `child:${childCnt} users:${userCnt} objs:${objCnt}` : 'ok';
  console.debug('[AdminOrgs][TreeNode] delete-state', { id: node.id, name: node.name, deleteBlocked, reason: deleteReason });
  return (
    <li>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => onSelect(node.id)} className={selectedId === node.id ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}>{selectedId === node.id ? '선택됨' : '선택'}</button>
        <strong>{node.name}</strong>
        <span style={{ fontSize: 12, color: '#6b7280' }}>({node.type})</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>child:{node.children?.length || 0} users:{node.counts?.users || 0} objs:{node.counts?.objectives || 0}</span>
        <button
          onClick={() => { console.log('[AdminOrgs] delete-click', { id: node.id, name: node.name, deleteBlocked, reason: deleteReason }); onDelete(node.id); }}
          disabled={deleteBlocked}
          title={deleteBlocked ? '자식/사용자/목표 해제 후 삭제 가능' : '삭제'}
          className="btn btn-danger btn-sm"
        >
          삭제
        </button>
        {deleteBlocked && (
          <button
            onClick={() => { console.warn('[AdminOrgs] force-delete-click', { id: node.id, name: node.name, reason: deleteReason }); onForceDelete(node.id); }}
            className="btn btn-warning btn-sm"
            title={`강제 삭제(연쇄 삭제): ${deleteReason}`}
          >
            강제삭제
          </button>
        )}
      </div>
      {node.children && node.children.length > 0 && (
        <ul>
          {node.children.map((c: any) => (
            <TreeNode key={c.id} node={c} onDelete={onDelete} onForceDelete={onForceDelete} onSelect={onSelect} selectedId={selectedId} />
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
  const [addUsername, setAddUsername] = useState('');
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [userQuery, setUserQuery] = useState('');
  const isProdApi = typeof API_BASE === 'string' && API_BASE.includes('production');

  const [name, setName] = useState('');
  const [type, setType] = useState('TEAM');
  const [parentId, setParentId] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const tree = await apiJson<{ items: any[] }>(`/api/orgs/tree`);
      const list = await apiJson<{ items: any[] }>(`/api/orgs`);
      const users = await apiJson<{ items: any[] }>(`/api/users`);
      setItems(tree.items || []);
      setFlat(list.items || []);
      // Sort users by Korean collation on name, fallback to email
      const coll = new Intl.Collator('ko');
      const us = (users.items || []).slice().sort((a: any, b: any) => {
        const an = (a.name || a.email || '').toString();
        const bn = (b.name || b.email || '').toString();
        const c = coll.compare(an, bn);
        if (c !== 0) return c;
        return (a.email || '').localeCompare(b.email || '');
      });
      setAllUsers(us);
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

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) { setError('왼쪽 트리에서 조직을 먼저 선택하세요.'); return; }
    if (!addUsername) { setError('추가할 사용자 로그인 아이디를 입력하세요.'); return; }
    try {
      await apiJson(`/api/orgs/${encodeURIComponent(selectedId)}/members`, { method: 'POST', body: JSON.stringify({ username: addUsername }) });
      setAddUsername('');
      await loadMembers(selectedId);
      await load();
    } catch (e: any) {
      setError(e.message || '구성원 추가 실패');
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
    console.log('[AdminOrgs] onDelete-init', { id, selectedId });
    if (!confirm('정말 삭제하시겠습니까?\n자식 조직과 사용자 연결이 없는 경우에만 삭제됩니다.')) { console.log('[AdminOrgs] onDelete-cancelled', { id }); return; }
    try {
      console.log('[AdminOrgs] onDelete-request', { id });
      await apiJson(`/api/orgs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      console.log('[AdminOrgs] onDelete-success', { id });
      // If the deleted org is currently selected, clear selection and side data
      if (selectedId === id) {
        setSelectedId('');
        setMembers([]);
        setObjectives([]);
      }
      await load();
    } catch (e: any) {
      console.error('[AdminOrgs] onDelete-error', { id, message: e.message, stack: e.stack });
      setError(e.message || '삭제 실패');
    }
  }

  async function onForceDelete(id: string) {
    console.log('[AdminOrgs] forceDelete-init', { id, selectedId });
    const ok = confirm('강제 삭제를 진행할까요?\n이 조직과 모든 하위 조직, 목표/KR/과제, 사용자 연결이 연쇄적으로 제거됩니다.\n이 작업은 되돌릴 수 없습니다.');
    if (!ok) { console.log('[AdminOrgs] forceDelete-cancelled-1', { id }); return; }
    const word = prompt("문구를 입력하세요: FORCE DELETE");
    if ((word || '').toUpperCase() !== 'FORCE DELETE') { alert('문구가 일치하지 않습니다.'); console.log('[AdminOrgs] forceDelete-cancelled-2', { id, word }); return; }
    try {
      console.log('[AdminOrgs] forceDelete-request', { id });
      await apiJson(`/api/orgs/${encodeURIComponent(id)}/force-delete`, { method: 'POST', body: JSON.stringify({ confirm: 'FORCE DELETE' }) });
      console.log('[AdminOrgs] forceDelete-success', { id });
      if (selectedId === id) {
        setSelectedId('');
        setMembers([]);
        setObjectives([]);
      }
      await load();
    } catch (e: any) {
      console.error('[AdminOrgs] forceDelete-error', { id, message: e.message, stack: e.stack });
      setError(e.message || '강제 삭제 실패');
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
                <TreeNode key={n.id} node={n} onDelete={onDelete} onForceDelete={onForceDelete} onSelect={onSelect} selectedId={selectedId} />
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
                <form onSubmit={addMember} style={{ display: 'grid', gap: 6 }}>
                  <input
                    placeholder="검색: 이름 또는 이메일"
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    style={input}
                  />
                  <select
                    value={addUsername}
                    onChange={(e) => setAddUsername(e.target.value)}
                    style={input}
                  >
                    <option value="">구성원 선택</option>
                    {(() => {
                      const q = (userQuery || '').toLowerCase();
                      const existing = new Set((members || []).map((m: any) => (m.email || '').toLowerCase()));
                      return allUsers
                        .filter((u) => !existing.has((u.email || '').toLowerCase()))
                        .filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
                        .map((u) => (
                          <option key={u.id} value={u.email}>{`${u.name || u.email} (${u.email})`}</option>
                        ));
                    })()}
                  </select>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button className="btn btn-primary btn-sm" disabled={!addUsername}>추가</button>
                  </div>
                </form>
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
            {!isProdApi && (
              <>
                <h3 style={{ marginTop: 0, color: '#ef4444' }}>Danger Zone</h3>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                  전체 삭제: 조직 트리, 목표, KR, 과제, 업무일지를 모두 삭제합니다. 복구 불가.
                </div>
                <form onSubmit={nukeAll} style={{ display: 'grid', gap: 8 }}>
                  <input placeholder="DELETE EVERYTHING" value={nukeWord} onChange={(e) => setNukeWord(e.target.value)} style={input} />
                  <button className="btn btn-danger" disabled={nuking}>{nuking ? '삭제중…' : '모두 삭제'}</button>
                </form>
              </>
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
