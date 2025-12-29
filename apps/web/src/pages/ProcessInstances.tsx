import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiJson } from '../lib/api';

interface ProcTask {
  id: string;
  stageLabel?: string | null;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  status: string;
}
interface ProcItem {
  id: string;
  title: string;
  status: string;
  startAt: string;
  expectedEndAt?: string;
  template: { id: string; title: string };
  tasks: ProcTask[];
}

export function ProcessInstances() {
  const [items, setItems] = useState<ProcItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const arr = await apiJson<ProcItem[]>(`/api/processes`);
        setItems(arr || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fmt = (s?: string) => (s ? new Date(s).toLocaleString() : '');

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>진행 중 프로세스</h2>
      {loading && <div>불러오는 중...</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((it) => (
          <Link key={it.id} to={`/process/instances/${it.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{it.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{it.template?.title || ''}</div>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{it.status}</div>
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                시작: {fmt(it.startAt)}{it.expectedEndAt ? ` · 예상완료: ${fmt(it.expectedEndAt)}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {it.tasks.slice(0, 6).map((t) => (
                  <span key={t.id} style={{ border: '1px solid #e5e7eb', borderRadius: 999, padding: '2px 8px', fontSize: 11 }}>
                    {t.stageLabel ? `${t.stageLabel} · ` : ''}{t.taskType} · {t.status}
                  </span>
                ))}
                {it.tasks.length > 6 && <span style={{ fontSize: 12, color: '#9ca3af' }}>+{it.tasks.length - 6} more</span>}
              </div>
            </div>
          </Link>
        ))}
        {!items.length && !loading && <div style={{ fontSize: 12, color: '#9ca3af' }}>진행 중인 프로세스가 없습니다.</div>}
      </div>
    </div>
  );
}
