import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiJson } from '../lib/api';

interface InboxTask {
  id: string;
  name: string;
  stageLabel?: string | null;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  status: string;
  instance: { id: string; title: string; status: string; templateTitle?: string };
}

export function ProcessInbox() {
  const nav = useNavigate();
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<InboxTask[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      try {
        const arr = await apiJson<InboxTask[]>(`/api/processes/inbox?assigneeId=${encodeURIComponent(userId)}`);
        setItems(arr || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  const onExecute = async (t: InboxTask) => {
    const id = t.instance.id;
    const q = `?processInstanceId=${encodeURIComponent(id)}&taskInstanceId=${encodeURIComponent(t.id)}`;
    if (t.taskType === 'WORKLOG') {
      try { await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/start`, { method: 'POST' }); } catch {}
      nav(`/worklogs/new${q}`);
      return;
    }
    if (t.taskType === 'COOPERATION') {
      try { await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/start`, { method: 'POST' }); } catch {}
      nav(`/coops/request${q}`);
      return;
    }
    if (t.taskType === 'APPROVAL') {
      try { await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/start`, { method: 'POST' }); } catch {}
      nav(`/approvals/new${q}`);
      return;
    }
    try {
      await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/complete`, { method: 'POST' });
      setItems((prev) => prev.filter((x) => x.id !== t.id));
    } catch {}
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>내 프로세스 할 일</h2>
      {!userId && <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {loading && <div>불러오는 중...</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((t) => (
          <div key={t.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{t.name}{t.stageLabel ? ` · ${t.stageLabel}` : ''}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{t.taskType} · {t.status}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {t.status === 'READY' && (
                  <button className="btn btn-primary" onClick={() => onExecute(t)}>실행</button>
                )}
                <Link to={`/process/instances/${t.instance.id}`} className="btn btn-ghost">열기</Link>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              {t.instance.templateTitle ? `${t.instance.templateTitle} · ` : ''}{t.instance.title}
            </div>
          </div>
        ))}
        {!items.length && !loading && <div style={{ fontSize: 12, color: '#9ca3af' }}>처리할 할 일이 없습니다.</div>}
      </div>
    </div>
  );
}
