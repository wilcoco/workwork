import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

export function ApprovalsStatus() {
  const [filters, setFilters] = useState<{ requestedById?: string; approverId?: string; subjectType?: string; from?: string; to?: string }>({});
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [items, setItems] = useState<any[]>([]);
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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.requestedById) params.set('requestedById', filters.requestedById);
      if (filters.approverId) params.set('approverId', filters.approverId);
      if (filters.subjectType) params.set('subjectType', filters.subjectType);
      if (filters.from) params.set('from', new Date(filters.from).toISOString());
      if (filters.to) params.set('to', new Date(filters.to).toISOString());
      const qs = params.toString() ? `?${params.toString()}` : '';
      const s = await apiJson<{ counts: Record<string, number> }>(`/api/approvals/summary${qs}`);
      setSummary(s.counts || {});
      const l = await apiJson<{ items: any[] }>(`/api/approvals${qs}`);
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
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, minmax(0, 1fr))' }}>
        <input placeholder="요청자 ID(선택)" value={filters.requestedById || ''} onChange={(e) => onChange('requestedById', e.target.value)} style={input} />
        <input placeholder="현재 결재자 ID(선택)" value={filters.approverId || ''} onChange={(e) => onChange('approverId', e.target.value)} style={input} />
        <input placeholder="Subject Type(선택)" value={filters.subjectType || ''} onChange={(e) => onChange('subjectType', e.target.value)} style={input} />
        <input type="date" placeholder="From" value={filters.from || ''} onChange={(e) => onChange('from', e.target.value)} style={input} />
        <input type="date" placeholder="To" value={filters.to || ''} onChange={(e) => onChange('to', e.target.value)} style={input} />
      </div>
      <div>
        <button onClick={load} disabled={loading} style={primaryBtn}>{loading ? '로딩…' : '현황 불러오기'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, minmax(0, 1fr))' }}>
        {['PENDING','APPROVED','REJECTED','EXPIRED'].map((s) => (
          <div key={s} style={statCard}>
            <div style={{ fontSize: 12, color: '#64748b' }}>{s}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{summary[s] ?? 0}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <h3 style={{ margin: '8px 0 0' }}>최근 결재 요청</h3>
        <div style={{ display: 'grid', gap: 6 }}>
          {items.map((it) => (
            <div key={it.id} style={card}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b>{it.subjectType}</b>
                <span style={{ color: '#64748b' }}>/ {it.subjectId}</span>
                <span style={chip}>{it.status}</span>
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
