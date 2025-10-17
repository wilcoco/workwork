import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

function KrNode({ kr }: { kr: any }) {
  return (
    <li style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #F59E0B', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>KR</span>
        <div style={{ fontWeight: 600 }}>{kr.title}</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>({kr.metric} / {kr.target}{kr.unit ? ' ' + kr.unit : ''})</div>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{kr.type}</div>
      </div>
      {Array.isArray(kr.children) && kr.children.length > 0 && (
        <ul style={{ marginLeft: 18 }}>
          {kr.children.map((child: any) => (
            <ObjNode key={child.id} obj={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ObjNode({ obj }: { obj: any }) {
  return (
    <li style={{ marginTop: 10 }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: '#E6EEF7', color: '#0F3D73', border: '1px solid #0F3D73', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>O</span>
          <div style={{ fontWeight: 700 }}>{obj.title}</div>
          <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>[{obj.orgUnit?.name || '-'}] {obj.owner?.name || ''} ({obj.owner?.role || ''})</div>
        </div>
        {obj.description && <div style={{ color: '#374151' }}>{obj.description}</div>}
        <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(obj.periodStart).toLocaleDateString()} ~ {new Date(obj.periodEnd).toLocaleDateString()} · {obj.status}</div>
      </div>
      {Array.isArray(obj.keyResults) && obj.keyResults.length > 0 && (
        <ul style={{ marginLeft: 18 }}>
          {obj.keyResults.map((kr: any) => (
            <KrNode key={kr.id} kr={kr} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OkrMap() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiJson<{ items: any[] }>(`/api/okrs/map`);
        setItems(res.items || []);
      } catch (e: any) {
        setError(e.message || '로드 실패');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>전사 O-KR 구성도</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {loading ? (
        <div>로딩중…</div>
      ) : (
        <ul>
          {items.map((o) => (
            <ObjNode key={o.id} obj={o} />
          ))}
        </ul>
      )}
    </div>
  );
}
