import { useEffect, useMemo, useState } from 'react';
import { apiJson } from '../lib/api';

type User = { id: string; name: string; email?: string };
type OrgUnit = { id: string; name: string };
type ObjectiveOption = { id: string; title: string; pillar?: string | null; orgUnit?: { name?: string } | null };

type ProgressItem = {
  id: string;
  content: string;
  progressPct: number | null;
  createdBy: User;
  createdAt: string;
};

type InitiativeItem = {
  id: string;
  title: string;
  goal: string | null;
  description: string | null;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DELAYED' | 'COMPLETED' | 'CANCELLED';
  priority: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  assignee: User | null;
  createdBy: User;
  orgUnit: OrgUnit | null;
  alignsToObjective: { id: string; title: string; pillar?: string | null } | null;
  progressCount: number;
  latestProgress: ProgressItem | null;
  warning: string | null;
  createdAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: '미착수',
  IN_PROGRESS: '진행중',
  DELAYED: '지연',
  COMPLETED: '완료',
  CANCELLED: '취소',
};

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: '#94a3b8',
  IN_PROGRESS: '#3b82f6',
  DELAYED: '#ef4444',
  COMPLETED: '#22c55e',
  CANCELLED: '#64748b',
};

export function KeyInitiatives() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';

  const [items, setItems] = useState<InitiativeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [objectives, setObjectives] = useState<ObjectiveOption[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    goal: '',
    description: '',
    priority: 0,
    startDate: '',
    dueDate: '',
    assigneeId: '',
    orgUnitId: '',
    alignsToObjectiveId: '',
  });

  const [selectedItem, setSelectedItem] = useState<InitiativeItem | null>(null);
  const [progressList, setProgressList] = useState<ProgressItem[]>([]);
  const [newProgress, setNewProgress] = useState({ content: '', progressPct: '' });

  useEffect(() => {
    loadData();
    loadUsers();
    loadOrgUnits();
    loadObjectives();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ actorId: userId });
      if (filterStatus) params.set('status', filterStatus);
      const res = await apiJson<InitiativeItem[]>(`/api/key-initiatives?${params}`);
      setItems(res || []);
    } catch (e: any) {
      setError(e?.message || '데이터를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const res = await apiJson<User[]>('/api/users');
      setUsers(res || []);
    } catch {}
  }

  async function loadOrgUnits() {
    try {
      const res = await apiJson<OrgUnit[]>('/api/orgs');
      setOrgUnits(res || []);
    } catch {}
  }

  async function loadObjectives() {
    try {
      const res = await apiJson<{ items: ObjectiveOption[] }>('/api/okrs/objectives');
      setObjectives(res.items || []);
    } catch {}
  }

  async function handleSubmit() {
    try {
      if (editingId) {
        await apiJson(`/api/key-initiatives/${editingId}?actorId=${userId}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
      } else {
        await apiJson(`/api/key-initiatives?actorId=${userId}`, {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ title: '', goal: '', description: '', priority: 0, startDate: '', dueDate: '', assigneeId: '', orgUnitId: '', alignsToObjectiveId: '' });
      loadData();
    } catch (e: any) {
      alert(e?.message || '저장 실패');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await apiJson(`/api/key-initiatives/${id}?actorId=${userId}`, { method: 'DELETE' });
      loadData();
      if (selectedItem?.id === id) setSelectedItem(null);
    } catch (e: any) {
      alert(e?.message || '삭제 실패');
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      await apiJson(`/api/key-initiatives/${id}?actorId=${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      loadData();
    } catch (e: any) {
      alert(e?.message || '상태 변경 실패');
    }
  }

  async function openDetail(item: InitiativeItem) {
    setSelectedItem(item);
    try {
      const res = await apiJson<ProgressItem[]>(`/api/key-initiatives/${item.id}/progress`);
      setProgressList(res || []);
    } catch {}
  }

  async function handleAddProgress() {
    if (!selectedItem || !newProgress.content.trim()) return;
    try {
      await apiJson(`/api/key-initiatives/${selectedItem.id}/progress?actorId=${userId}`, {
        method: 'POST',
        body: JSON.stringify({
          content: newProgress.content,
          progressPct: newProgress.progressPct ? parseInt(newProgress.progressPct, 10) : null,
        }),
      });
      setNewProgress({ content: '', progressPct: '' });
      openDetail(selectedItem);
      loadData();
    } catch (e: any) {
      alert(e?.message || '진행 사항 추가 실패');
    }
  }

  function startEdit(item: InitiativeItem) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      goal: item.goal || '',
      description: item.description || '',
      priority: item.priority,
      startDate: item.startDate || '',
      dueDate: item.dueDate || '',
      assigneeId: item.assignee?.id || '',
      orgUnitId: item.orgUnit?.id || '',
      alignsToObjectiveId: item.alignsToObjective?.id || '',
    });
    setShowForm(true);
  }

  const filtered = useMemo(() => {
    if (!filterStatus) return items;
    return items.filter((it) => it.status === filterStatus);
  }, [items, filterStatus]);

  const fmtDate = (d: string | null) => d || '—';

  const th: React.CSSProperties = {
    borderBottom: '2px solid #e2e8f0',
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: 12,
    fontWeight: 700,
    color: '#475569',
    background: '#f8fafc',
    whiteSpace: 'nowrap',
  };
  const td: React.CSSProperties = {
    borderBottom: '1px solid #f1f5f9',
    padding: '8px 10px',
    fontSize: 13,
    verticalAlign: 'top',
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>중점 추진 과제</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); }}
            style={{ padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
          >
            <option value="">전체 상태</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ title: '', goal: '', description: '', priority: 0, startDate: '', dueDate: '', assigneeId: '', orgUnitId: '', alignsToObjectiveId: '' }); }}
            style={{ padding: '6px 14px', background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            + 과제 등록
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}

      {showForm && (
        <div style={{ padding: 16, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>{editingId ? '과제 수정' : '새 과제 등록'}</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#64748b' }}>과제명 *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#64748b' }}>과제 목표</label>
              <textarea
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
                rows={2}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, resize: 'vertical' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#64748b' }}>연결된 OKR (목표 정렬 · 선택)</label>
              <select
                value={form.alignsToObjectiveId}
                onChange={(e) => setForm({ ...form, alignsToObjectiveId: e.target.value })}
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
              >
                <option value="">미정렬 (돌발성/독립 과제)</option>
                {objectives.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orgUnit?.name ? `[${o.orgUnit.name}] ` : ''}{o.title}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: '#64748b' }}>담당자</label>
                <select
                  value={form.assigneeId}
                  onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
                >
                  <option value="">선택</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b' }}>담당 부서</label>
                <select
                  value={form.orgUnitId}
                  onChange={(e) => setForm({ ...form, orgUnitId: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
                >
                  <option value="">선택</option>
                  {orgUnits.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: '#64748b' }}>시작일</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b' }}>기한</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#64748b' }}>우선순위</label>
                <input
                  type="number"
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 0 })}
                  style={{ width: '100%', padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                style={{ padding: '6px 14px', background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                disabled={!form.title.trim()}
                style={{ padding: '6px 14px', background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: form.title.trim() ? 1 : 0.5 }}
              >
                {editingId ? '수정' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>로딩 중…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>등록된 과제가 없습니다.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>상태</th>
                <th style={th}>과제명</th>
                <th style={th}>담당자</th>
                <th style={th}>기한</th>
                <th style={th}>최근 진행</th>
                <th style={th}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(item)}>
                  <td style={td}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#fff',
                      background: STATUS_COLORS[item.status],
                    }}>
                      {STATUS_LABELS[item.status]}
                    </span>
                    {item.warning && (
                      <div style={{ fontSize: 11, color: item.warning.includes('초과') ? '#ef4444' : '#f59e0b', marginTop: 2 }}>
                        {item.warning}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 500 }}>{item.title}</div>
                    {item.goal && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.goal}
                      </div>
                    )}
                    {item.alignsToObjective && (
                      <div style={{ fontSize: 11, color: '#0F3D73', marginTop: 2, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        🎯 OKR: {item.alignsToObjective.title}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <div>{item.assignee?.name || '—'}</div>
                    {item.orgUnit && <div style={{ fontSize: 11, color: '#64748b' }}>{item.orgUnit.name}</div>}
                  </td>
                  <td style={td}>
                    <div>{fmtDate(item.dueDate)}</div>
                    {item.startDate && <div style={{ fontSize: 11, color: '#64748b' }}>시작: {item.startDate}</div>}
                  </td>
                  <td style={{ ...td, maxWidth: 200 }}>
                    {item.latestProgress ? (
                      <div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          {new Date(item.latestProgress.createdAt).toLocaleDateString('ko-KR')} · {item.latestProgress.createdBy.name}
                        </div>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.latestProgress.content}
                        </div>
                        {item.latestProgress.progressPct != null && (
                          <div style={{ fontSize: 11, color: '#3b82f6' }}>진행률: {item.latestProgress.progressPct}%</div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td style={td} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => startEdit(item)}
                        style={{ padding: '2px 8px', fontSize: 11, background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                      >
                        수정
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        style={{ padding: '2px 8px', fontSize: 11, background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedItem && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setSelectedItem(null)}>
          <div style={{ background: '#fff', borderRadius: 12, width: '90%', maxWidth: 600, maxHeight: '80vh', overflow: 'auto', padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>{selectedItem.title}</h3>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#fff',
                    background: STATUS_COLORS[selectedItem.status],
                  }}>
                    {STATUS_LABELS[selectedItem.status]}
                  </span>
                  {selectedItem.warning && (
                    <span style={{ fontSize: 11, color: selectedItem.warning.includes('초과') ? '#ef4444' : '#f59e0b' }}>
                      {selectedItem.warning}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedItem(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>

            <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
              {selectedItem.goal && (
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>과제 목표</div>
                  <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{selectedItem.goal}</div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>담당자</div>
                  <div style={{ fontSize: 13 }}>{selectedItem.assignee?.name || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>담당 부서</div>
                  <div style={{ fontSize: 13 }}>{selectedItem.orgUnit?.name || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>시작일</div>
                  <div style={{ fontSize: 13 }}>{selectedItem.startDate || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>기한</div>
                  <div style={{ fontSize: 13 }}>{selectedItem.dueDate || '—'}</div>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>상태 변경</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => handleStatusChange(selectedItem.id, v)}
                      style={{
                        padding: '4px 10px',
                        fontSize: 11,
                        background: selectedItem.status === v ? STATUS_COLORS[v] : '#f1f5f9',
                        color: selectedItem.status === v ? '#fff' : '#475569',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
              <h4 style={{ margin: '0 0 12px', fontSize: 13 }}>진행 사항 ({progressList.length}건)</h4>

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="진행 내용 입력..."
                  value={newProgress.content}
                  onChange={(e) => setNewProgress({ ...newProgress, content: e.target.value })}
                  style={{ flex: 1, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
                />
                <input
                  type="number"
                  placeholder="%"
                  value={newProgress.progressPct}
                  onChange={(e) => setNewProgress({ ...newProgress, progressPct: e.target.value })}
                  style={{ width: 60, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }}
                />
                <button
                  onClick={handleAddProgress}
                  disabled={!newProgress.content.trim()}
                  style={{ padding: '6px 12px', background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, opacity: newProgress.content.trim() ? 1 : 0.5 }}
                >
                  추가
                </button>
              </div>

              <div style={{ display: 'grid', gap: 8, maxHeight: 300, overflow: 'auto' }}>
                {progressList.length === 0 ? (
                  <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>진행 사항이 없습니다.</div>
                ) : (
                  progressList.map((p) => (
                    <div key={p.id} style={{ padding: 10, background: '#f8fafc', borderRadius: 6, borderLeft: '3px solid #3b82f6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          {new Date(p.createdAt).toLocaleString('ko-KR')} · {p.createdBy.name}
                        </span>
                        {p.progressPct != null && (
                          <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600 }}>{p.progressPct}%</span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{p.content}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
