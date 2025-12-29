import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiJson } from '../lib/api';

interface ProcTask {
  id: string;
  name: string;
  stageLabel?: string | null;
  taskType: 'COOPERATION' | 'WORKLOG' | 'APPROVAL' | 'TASK';
  status: string;
  deadlineAt?: string;
  actualEndAt?: string;
}
interface ProcInst {
  id: string;
  title: string;
  status: string;
  startAt: string;
  expectedEndAt?: string;
  endAt?: string;
  itemCode?: string;
  moldCode?: string;
  carModelCode?: string;
  template: { id: string; title: string };
  tasks: ProcTask[];
}

export function ProcessInstanceDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [inst, setInst] = useState<ProcInst | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const data = await apiJson<ProcInst>(`/api/processes/${encodeURIComponent(id)}`);
        setInst(data || null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const fmt = (s?: string) => (s ? new Date(s).toLocaleString() : '');

  const grouped = useMemo(() => {
    const map = new Map<string, ProcTask[]>();
    for (const t of inst?.tasks || []) {
      const key = t.stageLabel || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries());
  }, [inst]);

  if (loading && !inst) return <div>불러오는 중...</div>;
  if (!inst) return <div>존재하지 않는 프로세스입니다.</div>;

  async function reload() {
    if (!id) return;
    const data = await apiJson<ProcInst>(`/api/processes/${encodeURIComponent(id)}`);
    setInst(data || null);
  }

  const onExecute = async (t: ProcTask) => {
    if (!id) return;
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
    // TASK: 바로 완료 처리
    try {
      await apiJson(`/api/processes/${encodeURIComponent(id)}/tasks/${encodeURIComponent(t.id)}/complete`, { method: 'POST' });
      await reload();
    } catch {
      // ignore
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>프로세스 상세</h2>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 800 }}>{inst.title}</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>{inst.template?.title || ''}</div>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{inst.status}</div>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
          시작: {fmt(inst.startAt)}{inst.expectedEndAt ? ` · 예상완료: ${fmt(inst.expectedEndAt)}` : ''}{inst.endAt ? ` · 완료: ${fmt(inst.endAt)}` : ''}
        </div>
        {(inst.itemCode || inst.moldCode || inst.carModelCode) && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            {[inst.itemCode && `품번:${inst.itemCode}`, inst.moldCode && `금형:${inst.moldCode}`, inst.carModelCode && `차종:${inst.carModelCode}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {grouped.map(([stage, tasks]) => (
          <div key={stage || '(no-stage)'} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{stage || '단계 미지정'}</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {tasks.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #eef2f7', borderRadius: 6, padding: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{t.taskType} · {t.status}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {t.status === 'READY' && (
                      <button className="btn btn-primary" onClick={() => onExecute(t)}>실행</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!grouped.length && <div style={{ fontSize: 12, color: '#9ca3af' }}>과제가 없습니다.</div>}
      </div>
    </div>
  );
}
