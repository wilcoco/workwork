import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

export function CoopsStatus() {
  const [filters, setFilters] = useState<{ requesterId?: string; assigneeId?: string; from?: string; to?: string }>({});
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);

  // Load users for dropdown filters
  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: Array<{ id: string; name: string; orgName?: string }> }>(`/api/users`);
        setUsers((res.items || []).map((u: any) => ({ id: u.id, name: u.name, orgName: u.orgName })));
      } catch {}
    })();
  }, []);

  // Auto-load on mount
  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.requesterId) params.set('requesterId', filters.requesterId);
      if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
      if (filters.from) params.set('from', new Date(filters.from).toISOString());
      if (filters.to) params.set('to', new Date(filters.to).toISOString());
      const qs = params.toString() ? `?${params.toString()}` : '';
      const s = await apiJson<{ counts: Record<string, number> }>(`/api/help-tickets/summary${qs}`);
      setSummary(s.counts || {});
      const l = await apiJson<{ items: any[] }>(`/api/help-tickets${qs}`);
      setItems(l.items || []);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  function onChange<K extends keyof typeof filters>(k: K, v: string) {
    setFilters((prev) => ({ ...prev, [k]: v || undefined }));
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={filters.requesterId || ''}
          onChange={(e) => onChange('requesterId', e.target.value)}
          style={{ ...input, minWidth: 160 }}
        >
          <option value="">전체 요청자</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
          ))}
        </select>
        <select
          value={filters.assigneeId || ''}
          onChange={(e) => onChange('assigneeId', e.target.value)}
          style={{ ...input, minWidth: 160 }}
        >
          <option value="">전체 담당자</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
          ))}
        </select>
        <input type="date" placeholder="From" value={filters.from || ''} onChange={(e) => onChange('from', e.target.value)} style={{ ...input, minWidth: 140 }} />
        <input type="date" placeholder="To" value={filters.to || ''} onChange={(e) => onChange('to', e.target.value)} style={{ ...input, minWidth: 140 }} />
        <button onClick={load} disabled={loading} style={primaryBtn}>{loading ? '로딩…' : '검색'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
        {[
          { key: 'OPEN', label: '미수신', color: '#f59e0b' },
          { key: 'ACCEPTED', label: '수락됨', color: '#3b82f6' },
          { key: 'IN_PROGRESS', label: '진행중', color: '#8b5cf6' },
          { key: 'BLOCKED', label: '보류', color: '#ef4444' },
          { key: 'DONE', label: '완료', color: '#22c55e' },
          { key: 'CANCELLED', label: '취소', color: '#6b7280' },
        ].map((s) => (
          <div key={s.key} style={{ ...statCard, borderTop: `3px solid ${s.color}` }}>
            <div style={{ fontSize: 12, color: s.color, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{summary[s.key] ?? 0}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 0' }}>
          <h3 style={{ margin: 0 }}>전체 요청 목록</h3>
          <span style={{ fontSize: 13, color: '#64748b' }}>({items.length}건)</span>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map((it) => {
            const statusLabel: Record<string, string> = {
              OPEN: '미수신',
              ACCEPTED: '수락됨',
              IN_PROGRESS: '진행중',
              BLOCKED: '보류',
              DONE: '완료',
              CANCELLED: '취소',
            };
            const statusColor: Record<string, string> = {
              OPEN: '#f59e0b',
              ACCEPTED: '#3b82f6',
              IN_PROGRESS: '#8b5cf6',
              BLOCKED: '#ef4444',
              DONE: '#22c55e',
              CANCELLED: '#6b7280',
            };
            return (
              <div key={it.id} style={card}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ ...chip, background: statusColor[it.status] || '#64748b', color: '#fff', border: 'none' }}>
                    {statusLabel[it.status] || it.status}
                  </span>
                  <b>{it.helpTitle || it.category || '(제목 없음)'}</b>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{new Date(it.createdAt).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 13, color: '#334155', marginTop: 4, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <span>📤 요청자: <b>{it.requester?.name || '-'}</b></span>
                  <span>📥 담당자: <b>{it.assignee?.name || '미지정'}</b></span>
                  {it.resolvedAt && <span>✅ 완료: {new Date(it.resolvedAt).toLocaleString()}</span>}
                </div>
                {it.resolvedAt && it.createdAt && (
                  <div style={{ fontSize: 12, color: '#16a34a', marginTop: 4 }}>
                    ⏱️ 처리 시간: {Math.round((new Date(it.resolvedAt).getTime() - new Date(it.createdAt).getTime()) / (1000 * 60 * 60))}시간
                  </div>
                )}
                {it.responseWorklogId && (
                  <div style={{ marginTop: 6 }}>
                    <a
                      href={`/worklog/${it.responseWorklogId}`}
                      style={{ fontSize: 12, color: '#0369a1', textDecoration: 'underline' }}
                    >
                      📋 대응 업무일지 보기
                    </a>
                  </div>
                )}
              </div>
            );
          })}
          {!items.length && <div style={{ color: '#9ca3af' }}>표시할 항목 없음</div>}
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

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#F8FAFC',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: 12,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.04)'
};

const statCard: React.CSSProperties = {
  background: '#F8FAFC',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: 12,
  textAlign: 'center' as const,
};

const chip: React.CSSProperties = {
  background: '#E6EEF7',
  color: '#0F3D73',
  border: '1px solid #0F3D73',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 12,
  fontWeight: 700,
};
