import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { BpmnMiniView } from '../components/BpmnMiniView';
import { toSafeHtml } from '../lib/richText';
import { WorklogDocument } from '../components/WorklogDocument';
import { UserAvatar } from '../components/UserAvatar';

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

interface TaskWorklog {
  id: string;
  note?: string;
  createdAt: string;
  createdBy?: { id: string; name: string };
}

interface ProcessDetail {
  id: string;
  title: string;
  status: string;
  startAt?: string;
  endAt?: string;
  template?: {
    id: string;
    title: string;
    description?: string;
    bpmnJson?: any;
    tasks?: Array<{
      id: string;
      name: string;
      taskType: string;
      description?: string;
    }>;
  };
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
    worklogs?: TaskWorklog[];
  }>;
}

export function ProcessMy() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [items, setItems] = useState<MyProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProcessDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [worklogPopup, setWorklogPopup] = useState<TaskWorklog | null>(null);

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

  const completeTask = async (processId: string, taskId: string) => {
    if (!window.confirm('이 과제를 완료 처리하시겠습니까?')) return;
    try {
      await apiJson(`/api/processes/${encodeURIComponent(processId)}/tasks/${encodeURIComponent(taskId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      // Refresh detail
      openDetail(processId);
    } catch (err: any) {
      alert(err?.message || '완료 처리 실패');
    }
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
              {p.template?.title || ''}
              {p.startedBy ? (
                <>
                  {' '}· 시작: {p.startedBy.name} <UserAvatar userId={String(p.startedBy.id || '')} name={String(p.startedBy.name || '')} size={14} style={{ marginLeft: 4 }} />
                </>
              ) : null}
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

                {detail.template?.description && (
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>프로세스 설명</div>
                    <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(detail.template.description) }} />
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: '#f9fafb', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #e5e7eb' }}>업무 흐름도</div>
                    {detail.template?.bpmnJson ? (
                      <div style={{ padding: 12 }}><BpmnMiniView bpmn={detail.template.bpmnJson} height={400} /></div>
                    ) : (
                      <div style={{ padding: 10, fontSize: 12, color: '#9ca3af' }}>BPMN 정보가 없습니다.</div>
                    )}
                  </div>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', background: '#f9fafb', fontWeight: 700, fontSize: 13, borderBottom: '1px solid #e5e7eb' }}>노드별 설명</div>
                    <div style={{ padding: 12, maxHeight: 400, overflowY: 'auto' }}>
                      {(detail.template?.tasks || []).length > 0 ? (
                        <div style={{ display: 'grid', gap: 10 }}>
                          {(detail.template?.tasks || []).map((tt) => (
                            <div key={tt.id} style={{ border: '1px solid #eef2f7', borderRadius: 6, padding: 10 }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontWeight: 600 }}>{tt.name || '-'}</span>
                                <span style={{ fontSize: 11, color: '#6b7280', background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{tt.taskType}</span>
                              </div>
                              {tt.description ? (
                                <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(tt.description) }} />
                              ) : (
                                <div style={{ fontSize: 12, color: '#9ca3af' }}>설명 없음</div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>노드 정보가 없습니다.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>과제 진행 현황</div>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {(detail.template?.tasks || []).map((tmplTask) => {
                      const instanceTasks = (detail.tasks || []).filter((t) => t.name === tmplTask.name);
                      return (
                        <div key={tmplTask.id} style={{ border: '1px solid #eef2f7', borderRadius: 8, padding: 12 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: 14 }}>{tmplTask.name || '-'}</span>
                            <span style={{ fontSize: 11, color: '#6b7280', background: '#f1f5f9', padding: '2px 8px', borderRadius: 4 }}>{tmplTask.taskType}</span>
                          </div>
                          {tmplTask.description && (
                            <div style={{ fontSize: 13, marginBottom: 10, padding: 8, background: '#fafafa', borderRadius: 6 }} dangerouslySetInnerHTML={{ __html: toSafeHtml(tmplTask.description) }} />
                          )}
                          {instanceTasks.length > 0 ? (
                            <div style={{ display: 'grid', gap: 8 }}>
                              {instanceTasks.map((t) => (
                                <div key={t.id} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, background: '#fff' }}>
                                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
                                    <span style={{ fontWeight: 600, minWidth: 80, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                      {t.assignee?.name || '담당 미지정'}
                                      {t.assignee?.id && t.assignee?.name ? <UserAvatar userId={String(t.assignee.id)} name={String(t.assignee.name)} size={14} /> : null}
                                    </span>
                                    <span style={{ color: '#6b7280' }}>계획: {fmt(t.plannedStartAt)} ~ {fmt(t.plannedEndAt)}</span>
                                    {t.actualEndAt && <span style={{ color: '#059669' }}>완료: {fmt(t.actualEndAt)}</span>}
                                    <span style={{
                                      fontSize: 11,
                                      padding: '2px 6px',
                                      borderRadius: 999,
                                      background: t.status === 'COMPLETED' ? '#DCFCE7' : t.status === 'IN_PROGRESS' ? '#DBEAFE' : t.status === 'READY' ? '#E0F2FE' : '#F1F5F9',
                                      color: t.status === 'COMPLETED' ? '#166534' : t.status === 'IN_PROGRESS' ? '#1E3A8A' : t.status === 'READY' ? '#075985' : '#334155',
                                    }}>{t.status}</span>
                                  </div>
                                  {(t.worklogs || []).length > 0 && (
                                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eef2f7' }}>
                                      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>작성된 업무일지 ({t.worklogs?.length}건)</div>
                                      <div style={{ display: 'grid', gap: 4 }}>
                                        {(t.worklogs || []).map((wl) => (
                                          <div key={wl.id} style={{ fontSize: 12, padding: '4px 8px', background: '#f9fafb', borderRadius: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                                            <span style={{ color: '#6b7280' }}>{new Date(wl.createdAt).toLocaleDateString()}</span>
                                            <span style={{ fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                              {wl.createdBy?.name || '-'}
                                              {wl.createdBy?.id && wl.createdBy?.name ? <UserAvatar userId={String(wl.createdBy.id)} name={String(wl.createdBy.name)} size={14} /> : null}
                                            </span>
                                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569' }}>{wl.note?.replace(/<[^>]*>/g, '').substring(0, 50) || '(내용 없음)'}</span>
                                            <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setWorklogPopup(wl)}>보기</button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {t.status !== 'COMPLETED' && t.status !== 'SKIPPED' && t.assignee?.id === userId && (
                                    <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                                      <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => completeTask(detail.id, t.id)}>과제 완료</button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: '#9ca3af' }}>진행 정보 없음</div>
                          )}
                        </div>
                      );
                    })}
                    {!(detail.template?.tasks || []).length && <div style={{ fontSize: 12, color: '#9ca3af' }}>과제가 없습니다.</div>}
                  </div>
                </div>
              </div>
            )}
            {!detailLoading && !detail && <div style={{ color: '#dc2626' }}>상세 정보를 불러오지 못했습니다.</div>}
          </div>
        </div>
      )}

      {worklogPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={() => setWorklogPopup(null)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, width: 'min(600px, 90vw)', maxHeight: '80vh', overflow: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0 }}>업무일지 상세</h4>
              <button className="btn" onClick={() => setWorklogPopup(null)}>닫기</button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              작성자: {worklogPopup.createdBy?.name || '-'}
              {worklogPopup.createdBy?.id && worklogPopup.createdBy?.name ? (
                <UserAvatar userId={String(worklogPopup.createdBy.id)} name={String(worklogPopup.createdBy.name)} size={14} style={{ marginLeft: 4 }} />
              ) : null}
              {' '}· {new Date(worklogPopup.createdAt).toLocaleString()}
            </div>
            <div style={{ marginBottom: 8, fontWeight: 800, fontSize: 16 }}>
              {String(worklogPopup.note || '').split(/\n+/)[0] || '(제목 없음)'}
            </div>
            <WorklogDocument worklog={worklogPopup} variant="content" />
          </div>
        </div>
      )}
    </div>
  );
}
