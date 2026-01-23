import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { Link } from 'react-router-dom';

type UserLite = {
  id: string;
  email: string;
  name: string;
  role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL';
  status?: 'PENDING' | 'ACTIVE' | string;
  activatedAt?: string | null;
  orgUnitId: string;
  orgName: string;
};

type OrgLite = {
  id: string;
  name: string;
};

export function AdminMembers() {
  const [items, setItems] = useState<UserLite[]>([]);
  const [orgs, setOrgs] = useState<OrgLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [myUserId, setMyUserId] = useState('');
  const [myRole, setMyRole] = useState<'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' | ''>('');
  const [drafts, setDrafts] = useState<Record<string, { role: UserLite['role']; orgUnitId: string }>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [bulkLimit, setBulkLimit] = useState<string>('50');
  const [bulkSyncing, setBulkSyncing] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const url = myRole === 'CEO' && myUserId
        ? `/api/users?includePending=1&includeExternal=1&userId=${encodeURIComponent(myUserId)}`
        : '/api/users';
      const res = await apiJson<{ items: UserLite[] }>(url);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }

  async function syncOnePhoto(id: string) {
    if (myRole !== 'CEO' || !myUserId) return;
    if (syncing[id]) return;
    setError(null);
    setNotice(null);
    setSyncing((prev) => ({ ...prev, [id]: true }));
    try {
      const r = await apiJson<{ ok: boolean; updated?: boolean; reason?: string }>(
        `/api/users/${encodeURIComponent(id)}/sync-teams-photo?actorId=${encodeURIComponent(myUserId)}`,
        { method: 'POST' }
      );
      if (r?.updated) setNotice('Teams 사진 동기화 완료');
      else setNotice(`Teams 사진 없음 (${r?.reason || 'no photo'})`);
    } catch (e: any) {
      setError(e?.message || 'Teams 사진 동기화 실패');
    } finally {
      setSyncing((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function syncBulkPhotos() {
    if (myRole !== 'CEO' || !myUserId) return;
    if (bulkSyncing) return;
    const n = Math.max(1, Math.min(500, parseInt(String(bulkLimit || '50'), 10) || 50));
    if (!confirm(`Teams 사진을 일괄 동기화할까요? (최대 ${n}명)`)) return;
    setError(null);
    setNotice(null);
    setBulkSyncing(true);
    try {
      const r = await apiJson<any>(
        `/api/users/sync-teams-photos?actorId=${encodeURIComponent(myUserId)}&limit=${encodeURIComponent(String(n))}`,
        { method: 'POST' }
      );
      const updated = Number(r?.updated || 0);
      const skipped = Number(r?.skipped || 0);
      const failed = Array.isArray(r?.failed) ? r.failed.length : 0;
      setNotice(`Teams 사진 일괄 동기화 완료: updated=${updated}, skipped=${skipped}, failed=${failed}`);
    } catch (e: any) {
      setError(e?.message || 'Teams 사진 일괄 동기화 실패');
    } finally {
      setBulkSyncing(false);
    }
  }

  async function loadOrgs() {
    try {
      const res = await apiJson<{ items: OrgLite[] }>(`/api/orgs`);
      setOrgs(res.items || []);
    } catch {
      setOrgs([]);
    }
  }

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setMyUserId(uid);
    if (!uid) {
      load();
      return;
    }
    (async () => {
      try {
        const me = await apiJson<{ id: string; role: 'CEO' | 'EXEC' | 'MANAGER' | 'INDIVIDUAL' | 'EXTERNAL' }>(`/api/users/me?userId=${encodeURIComponent(uid)}`);
        setMyRole((me as any).role || '');
      } catch {
        setMyRole('');
      }
    })();
  }, []);

  useEffect(() => {
    loadOrgs();
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRole, myUserId]);

  useEffect(() => {
    const next: Record<string, { role: UserLite['role']; orgUnitId: string }> = {};
    for (const u of items) {
      next[u.id] = { role: u.role, orgUnitId: u.orgUnitId || '' };
    }
    setDrafts(next);
  }, [items]);

  async function onDelete(id: string) {
    if (myRole !== 'CEO' || !myUserId) return;
    if (!confirm('해당 구성원을 삭제할까요?')) return;
    try {
      await apiJson(`/api/users/${encodeURIComponent(id)}?actorId=${encodeURIComponent(myUserId)}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((u) => u.id !== id));
    } catch (e: any) {
      alert(e?.message || '삭제할 수 없습니다.');
    }
  }

  async function onSave(id: string) {
    if (myRole !== 'CEO' || !myUserId) return;
    const u = items.find((x) => x.id === id);
    const d = drafts[id];
    if (!u || !d) return;
    const nextRole = d.role;
    const nextOrgUnitId = d.orgUnitId || '';
    const changedRole = nextRole !== u.role;
    const changedOrg = (nextOrgUnitId || '') !== (u.orgUnitId || '');
    if (!changedRole && !changedOrg) return;
    try {
      if (changedRole) {
        await apiJson(`/api/users/${encodeURIComponent(id)}/role?actorId=${encodeURIComponent(myUserId)}`, {
          method: 'PUT',
          body: JSON.stringify({ role: nextRole }),
        });
      }
      let orgName = u.orgName;
      if (changedOrg && nextRole !== 'EXTERNAL') {
        const res = await apiJson<{ orgUnitId: string; orgName: string }>(`/api/users/${encodeURIComponent(id)}/orgUnit?actorId=${encodeURIComponent(myUserId)}`, {
          method: 'PUT',
          body: JSON.stringify({ orgUnitId: nextOrgUnitId }),
        });
        orgName = res?.orgName || '';
      }
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, role: nextRole, orgUnitId: nextRole === 'EXTERNAL' ? '' : nextOrgUnitId, orgName: nextRole === 'EXTERNAL' ? '' : orgName } : x)));
    } catch (e: any) {
      alert(e?.message || '저장할 수 없습니다.');
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

  function roleLabel(r?: string) {
    if (r === 'CEO') return '대표';
    if (r === 'EXEC') return '임원';
    if (r === 'MANAGER') return '팀장';
    if (r === 'INDIVIDUAL') return '팀원';
    if (r === 'EXTERNAL') return '조직외';
    return r || '';
  }

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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {myRole === 'CEO' && (
              <>
                <input
                  value={bulkLimit}
                  onChange={(e) => setBulkLimit(e.target.value)}
                  style={{ ...input, width: 92, padding: '8px 10px' }}
                  placeholder="50"
                />
                <button className="btn btn-sm" onClick={syncBulkPhotos} disabled={bulkSyncing}>
                  {bulkSyncing ? '동기화…' : 'Teams 사진 일괄 동기화'}
                </button>
              </>
            )}
            <button className="btn btn-ghost" onClick={load} disabled={loading}>{loading ? '새로고침…' : '새로고침'}</button>
          </div>
        </div>
        {error && <div style={{ color: 'red' }}>{error}</div>}
        {notice && <div style={{ color: '#0f172a' }}>{notice}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>이름</th>
                <th style={{ textAlign: 'left' }}>이메일</th>
                <th style={{ textAlign: 'left' }}>역할</th>
                <th style={{ textAlign: 'left' }}>상태</th>
                <th style={{ textAlign: 'left' }}>조직</th>
                <th style={{ textAlign: 'right' }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    {myRole === 'CEO' ? (
                      <select
                        value={(drafts[u.id]?.role || u.role) as any}
                        onChange={(e) => {
                          const nextRole = e.target.value as any;
                          setDrafts((prev) => ({
                            ...prev,
                            [u.id]: {
                              role: nextRole,
                              orgUnitId: nextRole === 'EXTERNAL' ? '' : (prev[u.id]?.orgUnitId ?? (u.orgUnitId || '')),
                            },
                          }));
                        }}
                      >
                        <option value="INDIVIDUAL">팀원</option>
                        <option value="MANAGER">팀장</option>
                        <option value="EXEC">임원</option>
                        <option value="CEO">대표</option>
                        <option value="EXTERNAL">조직외</option>
                      </select>
                    ) : (
                      roleLabel(u.role)
                    )}
                  </td>
                  <td>{(u as any).status === 'PENDING' ? '대기' : '활성'}</td>
                  <td>
                    {myRole === 'CEO' ? (
                      <select
                        value={(drafts[u.id]?.orgUnitId ?? (u.orgUnitId || ''))}
                        disabled={(drafts[u.id]?.role ?? u.role) === 'EXTERNAL'}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [u.id]: { role: prev[u.id]?.role ?? u.role, orgUnitId: e.target.value } }))}
                      >
                        <option value="">-</option>
                        {orgs.map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    ) : (
                      (u.orgName || '-')
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {myRole === 'CEO' ? (
                      <>
                        <button
                          className="btn btn-sm"
                          style={{ marginRight: 8 }}
                          onClick={() => syncOnePhoto(u.id)}
                          disabled={!!syncing[u.id]}
                        >
                          {syncing[u.id] ? '동기화…' : '사진 동기화'}
                        </button>
                        <button className="btn btn-sm" style={{ marginRight: 8 }} onClick={() => onSave(u.id)}>저장</button>
                        <button className="btn btn-sm btn-danger" onClick={() => onDelete(u.id)}>삭제</button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: '#6b7280' }}>구성원이 없습니다</td>
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
