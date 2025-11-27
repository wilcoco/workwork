import { useEffect, useMemo, useState, Fragment } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

export function OkrTree() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}); // KR.id -> expanded
  const defaultExpandDepth = 1; // CEO -> EXEC 상세

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const r = await apiJson<{ items: any[] }>(`/api/okrs/map`);
        setItems(r.items || []);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function ObjectiveCard({ o, depth }: { o: any; depth: number }) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{o.orgUnit?.name || '-'}</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{(o.periodStart ? formatKstDatetime(o.periodStart) : '-') + ' ~ ' + (o.periodEnd ? formatKstDatetime(o.periodEnd) : '-')}</div>
        </div>
        <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{o.title}</div>
        {o.description && <div style={{ marginTop: 6, color: '#374151' }}>{o.description}</div>}

        {/* KRs */}
        {o.keyResults?.length > 0 && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {o.keyResults.map((kr: any) => (
              <div key={kr.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 600 }}>KR:</div>
                  <div>{kr.title}</div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>
                      {kr.metric}
                      {kr.target != null ? ` / ${kr.target}${kr.unit ? ' ' + kr.unit : ''}` : ''}
                    </span>
                    <button className="btn btn-ghost" onClick={() => setExpanded((prev) => ({ ...prev, [kr.id]: !prev[kr.id] }))}>
                      {expanded[kr.id] || depth < defaultExpandDepth ? '접기' : `하위 보기 (${(kr.children || []).length})`}
                    </button>
                  </div>
                </div>
                {/* Child objectives under this KR */}
                {(expanded[kr.id] || depth < defaultExpandDepth) && kr.children?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                    {kr.children.map((child: any) => (
                      <ObjectiveCard key={child.id} o={child} depth={depth + 1} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 12, maxWidth: 1080, margin: '24px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>OKR 조회</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={loading} onClick={() => window.location.reload()} className="btn btn-primary">새로고침</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {items.map((o) => (
          <ObjectiveCard key={o.id} o={o} depth={0} />
        ))}
        {!items.length && !loading && <div style={{ color: '#64748b' }}>표시할 OKR이 없습니다.</div>}
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderLeft: '4px solid #0F3D73',
  borderRadius: 12,
  padding: 14,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.06)'
};
