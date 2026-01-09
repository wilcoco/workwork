import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

interface MyProcess {
  id: string;
  title: string;
  status: string;
  startAt?: string;
  endAt?: string;
  template?: { id: string; title: string };
  startedBy?: { id: string; name: string };
  myTaskSummary?: { total: number; completed: number; inProgress: number };
}

export function ProcessMy() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<MyProcess[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      try {
        const arr = await apiJson<MyProcess[]>(`/api/processes/my?userId=${encodeURIComponent(userId)}`);
        setItems(arr || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '-');

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!userId && <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {loading && <div>불러오는 중...</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((p) => (
          <Link
            key={p.id}
            to={`/process/instances/${encodeURIComponent(p.id)}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'grid', gap: 6, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>{p.title}</div>
                <span style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: p.status === 'COMPLETED' ? '#DCFCE7' : p.status === 'ACTIVE' ? '#DBEAFE' : '#F1F5F9',
                  color: p.status === 'COMPLETED' ? '#166534' : p.status === 'ACTIVE' ? '#1E3A8A' : '#334155',
                }}>{p.status}</span>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {p.template?.title || ''}{p.startedBy ? ` · 시작: ${p.startedBy.name}` : ''}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {fmt(p.startAt)} ~ {p.endAt ? fmt(p.endAt) : '진행중'}
              </div>
              {p.myTaskSummary && (
                <div style={{ fontSize: 12, color: '#475569' }}>
                  내 과제: {p.myTaskSummary.completed}/{p.myTaskSummary.total} 완료
                  {p.myTaskSummary.inProgress ? ` · ${p.myTaskSummary.inProgress} 진행중` : ''}
                </div>
              )}
            </div>
          </Link>
        ))}
        {!items.length && !loading && <div style={{ fontSize: 12, color: '#9ca3af' }}>참여 중인 프로세스가 없습니다.</div>}
      </div>
    </div>
  );
}
