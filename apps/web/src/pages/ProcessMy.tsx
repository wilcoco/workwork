import { useEffect, useState } from 'react';
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

interface ProcessDetail {
  id: string;
  title: string;
  status: string;
  startAt?: string;
  endAt?: string;
  template?: { id: string; title: string };
  tasks?: Array<{
    id: string;
    name: string;
    stageLabel?: string;
    taskType: string;
    status: string;
    assignee?: { id: string; name: string } | null;
    plannedStartAt?: string;
    plannedEndAt?: string;
    actualStartAt?: string;
    actualEndAt?: string;
  }>;
}

export function ProcessMy() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<MyProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const openDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const d = await apiJson<ProcessDetail>(`/api/processes/${encodeURIComponent(id)}`);
      setDetail(d);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '-');
  const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '-');

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {!userId && <div style={{ color: '#DC2626' }}>로그인이 필요합니다.</div>}
      {loading && <div>불러오는 중...</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((p) => (
          <div
            key={p.id}
            onClick={() => openDetail(p.id)}
            style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, display: 'grid', gap: 6, cursor: 'pointer' }}
          >
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
        ))}
        {!items.length && !loading && <div style={{ fontSize: 12, color: '#9ca3af' }}>참여 중인 프로세스가 없습니다.</div>}
      </div>

      {selectedId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={closeDetail}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(900px, 95vw)', maxHeight: '90vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>프로세스 상세</h3>
              <button className="btn" onClick={closeDetail}>닫기</button>
            </div>
            {detailLoading && <div>불러오는 중...</div>}
            {!detailLoading && detail && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{detail.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    {detail.template?.title || ''} · {detail.status}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    시작: {fmtTime(detail.startAt)}{detail.endAt ? ` · 완료: ${fmtTime(detail.endAt)}` : ''}
                  </div>
                </div>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', background: '#f9fafb', padding: '8px 10px', fontWeight: 600, fontSize: 12 }}>
                    <div>과제</div>
                    <div>담당자</div>
                    <div>계획시작</div>
                    <div>계획완료</div>
                    <div>실완료</div>
                    <div>상태</div>
                  </div>
                  {(detail.tasks || []).map((t) => (
                    <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr', padding: '8px 10px', borderTop: '1px solid #eef2f7', fontSize: 12, alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{t.name || '-'}</div>
                        {t.stageLabel && <div style={{ color: '#6b7280' }}>{t.stageLabel}</div>}
                        <div style={{ color: '#9ca3af' }}>{t.taskType}</div>
                      </div>
                      <div>{t.assignee?.name || '-'}</div>
                      <div>{fmt(t.plannedStartAt)}</div>
                      <div>{fmt(t.plannedEndAt)}</div>
                      <div>{fmt(t.actualEndAt)}</div>
                      <div>
                        <span style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 999,
                          background: t.status === 'COMPLETED' ? '#DCFCE7' : t.status === 'IN_PROGRESS' ? '#DBEAFE' : t.status === 'READY' ? '#E0F2FE' : '#F1F5F9',
                          color: t.status === 'COMPLETED' ? '#166534' : t.status === 'IN_PROGRESS' ? '#1E3A8A' : t.status === 'READY' ? '#075985' : '#334155',
                        }}>{t.status}</span>
                      </div>
                    </div>
                  ))}
                  {!(detail.tasks || []).length && <div style={{ padding: 12, fontSize: 12, color: '#9ca3af' }}>과제가 없습니다.</div>}
                </div>
              </div>
            )}
            {!detailLoading && !detail && <div style={{ color: '#dc2626' }}>상세 정보를 불러오지 못했습니다.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
