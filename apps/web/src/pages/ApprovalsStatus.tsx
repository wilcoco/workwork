import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

export function ApprovalsStatus() {
  const [filters, setFilters] = useState<{ requestedById?: string; approverId?: string; query?: string; from?: string; to?: string; status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' }>({});
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [items, setItems] = useState<any[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth < 768);
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', update);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', update);
      }
    };
  }, []);

  useEffect(() => {
    setFilters((f) => ({ ...f }));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiJson<{ items: Array<{ id: string; name: string; orgName?: string }> }>(`/api/users`);
        setUsers(res.items || []);
      } catch {
        setUsers([]);
      }
    })();
  }, []);

  async function load(next?: typeof filters) {
    const f = next || filters;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (f.requestedById) params.set('requestedById', f.requestedById);
      if (f.approverId) params.set('approverId', f.approverId);
      if (f.query) params.set('query', f.query);
      if (f.from) params.set('from', new Date(f.from).toISOString());
      if (f.to) params.set('to', new Date(f.to).toISOString());

      const summaryParams = new URLSearchParams(params);
      summaryParams.delete('status');
      const sqs = summaryParams.toString() ? `?${summaryParams.toString()}` : '';
      const s = await apiJson<{ counts: Record<string, number> }>(`/api/approvals/summary${sqs}`);
      setSummary(s.counts || {});

      if (f.status) params.set('status', f.status);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const l = await apiJson<{ items: any[] }>(`/api/approvals${qs}`);
      setItems(l.items || []);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onChange<K extends keyof typeof filters>(k: K, v: string) {
    setFilters((prev) => ({ ...prev, [k]: (v || undefined) as any }));
  }

  function selectStatus(s?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED') {
    const next = { ...filters, status: s };
    setFilters(next);
    void load(next);
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))' }}>
        <div
          role="button"
          onClick={() => selectStatus(filters.status === 'PENDING' ? undefined : 'PENDING')}
          style={{ ...statCard, cursor: 'pointer', borderColor: filters.status === 'PENDING' ? '#0F3D73' : '#CBD5E1' }}
        >
          <div style={{ fontSize: 12, color: '#64748b' }}>미결재</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary['PENDING'] ?? 0}</div>
        </div>
        <div
          role="button"
          onClick={() => selectStatus(filters.status === 'APPROVED' ? undefined : 'APPROVED')}
          style={{ ...statCard, cursor: 'pointer', borderColor: filters.status === 'APPROVED' ? '#0F3D73' : '#CBD5E1' }}
        >
          <div style={{ fontSize: 12, color: '#64748b' }}>승인</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary['APPROVED'] ?? 0}</div>
        </div>
        <div
          role="button"
          onClick={() => selectStatus(filters.status === 'REJECTED' ? undefined : 'REJECTED')}
          style={{ ...statCard, cursor: 'pointer', borderColor: filters.status === 'REJECTED' ? '#0F3D73' : '#CBD5E1' }}
        >
          <div style={{ fontSize: 12, color: '#64748b' }}>반려</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary['REJECTED'] ?? 0}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(6, minmax(0, 1fr))' }}>
        <select value={filters.requestedById || ''} onChange={(e) => onChange('requestedById', e.target.value)} style={input}>
          <option value="">요청자(전체)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}{u.orgName ? ` (${u.orgName})` : ''}
            </option>
          ))}
        </select>
        <select value={filters.approverId || ''} onChange={(e) => onChange('approverId', e.target.value)} style={input}>
          <option value="">현재 결재자(전체)</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}{u.orgName ? ` (${u.orgName})` : ''}
            </option>
          ))}
        </select>
        <select value={filters.status || ''} onChange={(e) => onChange('status', e.target.value)} style={input}>
          <option value="">상태(전체)</option>
          <option value="PENDING">미결재</option>
          <option value="APPROVED">승인</option>
          <option value="REJECTED">반려</option>
          <option value="EXPIRED">만료</option>
        </select>
        <input placeholder="검색어(내용)" value={filters.query || ''} onChange={(e) => onChange('query', e.target.value)} style={input} />
        <input type="date" placeholder="From" value={filters.from || ''} onChange={(e) => onChange('from', e.target.value)} style={input} />
        <input type="date" placeholder="To" value={filters.to || ''} onChange={(e) => onChange('to', e.target.value)} style={input} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={() => void load()} disabled={loading} style={primaryBtn}>{loading ? '로딩…' : '검색'}</button>
        <button
          onClick={() => {
            const next: typeof filters = {};
            setFilters(next);
            void load(next);
          }}
          disabled={loading}
          style={ghostBtn}
        >
          초기화
        </button>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <h3 style={{ margin: '8px 0 0' }}>최근 결재 요청</h3>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map((it) => (
            <div key={it.id} style={card}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b>{it.subjectType}</b>
                <span style={{ color: '#64748b' }}>/ {it.subjectId}</span>
                <span style={chip}>{statusLabel(it.status)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{new Date(it.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 12, color: '#334155' }}>
                요청자: {it.requestedBy?.name || '-'} ({it.requestedBy?.id || '-'}) · 현재 결재자: {it.currentApprover?.name || '-'} ({it.currentApprover?.id || '-'})
              </div>
              {it.steps?.length ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                  {it.steps.map((s: any) => (
                    <span key={s.id} style={tinyChip}>{s.stepNo}. {s.approverId} · {s.status}</span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {!items.length && <div>표시할 항목 없음</div>}
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

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
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

const tinyChip: React.CSSProperties = {
  background: '#F1F5F9',
  color: '#334155',
  border: '1px solid #E2E8F0',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 11,
  fontWeight: 600,
};

function statusLabel(s?: string): string {
  if (s === 'APPROVED') return '승인';
  if (s === 'REJECTED') return '반려';
  if (s === 'EXPIRED') return '만료';
  return '미결재';
}
