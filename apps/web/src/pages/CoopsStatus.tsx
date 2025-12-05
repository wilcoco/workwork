import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

export function CoopsStatus() {
  const [filters, setFilters] = useState<{ requesterId?: string; assigneeId?: string; queue?: string; from?: string; to?: string }>({});
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
    // 기본값으로 requesterId를 비워 전사 현황을 보여줌
    setFilters((f) => ({ ...f }));
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.requesterId) params.set('requesterId', filters.requesterId);
      if (filters.assigneeId) params.set('assigneeId', filters.assigneeId);
      if (filters.queue) params.set('queue', filters.queue);
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
      <h2 style={{ margin: 0 }}>협조 통계</h2>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <input placeholder="요청자 ID(선택)" value={filters.requesterId || ''} onChange={(e) => onChange('requesterId', e.target.value)} style={input} />
        <input placeholder="담당자 ID(선택)" value={filters.assigneeId || ''} onChange={(e) => onChange('assigneeId', e.target.value)} style={input} />
        <input placeholder="큐(선택)" value={filters.queue || ''} onChange={(e) => onChange('queue', e.target.value)} style={input} />
        <input type="date" placeholder="From" value={filters.from || ''} onChange={(e) => onChange('from', e.target.value)} style={input} />
        <input type="date" placeholder="To" value={filters.to || ''} onChange={(e) => onChange('to', e.target.value)} style={input} />
      </div>
      <div>
        <button onClick={load} disabled={loading} style={primaryBtn}>{loading ? '로딩…' : '현황 불러오기'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
        {['OPEN','ACCEPTED','IN_PROGRESS','BLOCKED','DONE','CANCELLED'].map((s) => (
          <div key={s} style={statCard}>
            <div style={{ fontSize: 12, color: '#64748b' }}>{s}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{summary[s] ?? 0}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <h3 style={{ margin: '8px 0 0' }}>최근 항목</h3>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map((it) => (
            <div key={it.id} style={card}>
              <div style={{ display: 'flex', gap: 8 }}>
                <b>{it.category}</b>
                <span style={chip}>{it.status}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{new Date(it.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ fontSize: 12, color: '#334155' }}>
                요청자: {it.requester?.name || '-'} ({it.requester?.id || '-'}) · 담당: {it.assignee?.name || '-'} ({it.assignee?.id || '-'}) · 큐: {it.queue || '-'}
              </div>
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
