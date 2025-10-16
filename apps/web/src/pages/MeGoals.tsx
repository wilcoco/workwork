import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

export function MeGoals() {
  const [userId, setUserId] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uid = localStorage.getItem('userId') || '';
    setUserId(uid);
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ items: any[] }>(`/api/initiatives/my?userId=${encodeURIComponent(userId)}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const projects = items.filter((it) => it.type === 'PROJECT');
  const ops = items.filter((it) => it.type === 'OPERATIONAL');

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', display: 'grid', gap: 12, background: '#F8FAFC', padding: 12, borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>내 목표</h2>
        <button disabled={!userId || loading} onClick={load} style={primaryBtn}>{loading ? '새로고침…' : '새로고침'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>프로젝트형</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {projects.map((p) => (
            <div key={p.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
                <div style={{ marginLeft: 'auto', background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                  {p.startAt ? formatKstDatetime(p.startAt) : '-'} ~ {p.endAt ? formatKstDatetime(p.endAt) : '-'}
                </div>
              </div>
              <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{p.title}</div>
              {p.description && <div style={{ marginTop: 6, color: '#374151' }}>{p.description}</div>}
              {/* 간단 바차트(미니 간트)는 추후 추가 */}
            </div>
          ))}
          {!projects.length && <div style={{ color: '#64748b' }}>등록된 프로젝트형 과제가 없습니다.</div>}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>오퍼레이션형</h3>
        <div style={{ display: 'grid', gap: 8 }}>
          {ops.map((o) => (
            <div key={o.id} style={card}>              
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
                <div>주기:</div>
                <div style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                  {o.cadence || '-'} {o.cadenceAnchor ? `(${o.cadenceAnchor})` : ''}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                  {o.startAt ? formatKstDatetime(o.startAt) : '-'} ~ {o.endAt ? formatKstDatetime(o.endAt) : '-'}
                </div>
              </div>
              <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{o.title}</div>
              {o.description && <div style={{ marginTop: 6, color: '#374151' }}>{o.description}</div>}
              {/* 체크리스트 및 준수율은 후속 단계에서 표시 */}
            </div>
          ))}
          {!ops.length && <div style={{ color: '#64748b' }}>등록된 오퍼레이션형 과제가 없습니다.</div>}
        </div>
      </section>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '8px 12px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderLeft: '4px solid #0F3D73',
  borderRadius: 12,
  padding: 14,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.06)'
};
