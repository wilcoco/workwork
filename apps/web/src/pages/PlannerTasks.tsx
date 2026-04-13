import { useEffect, useState, CSSProperties } from 'react';
import { apiJson } from '../lib/api';

interface PlannerTask {
  id: string;
  title: string;
  planId: string;
  planName: string;
  bucketId: string;
  percentComplete: number;
  priority: number;
  startDateTime: string | null;
  dueDateTime: string | null;
  createdDateTime: string;
  completedDateTime: string | null;
  description: string;
  checklist: Record<string, { title: string; isChecked: boolean }>;
  etag: string;
  detailsEtag: string;
}

const card: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff', cursor: 'pointer', transition: 'box-shadow .15s' };
const primaryBtn: CSSProperties = { background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
const ghostBtn: CSSProperties = { background: 'transparent', color: '#0F3D73', border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const dangerBtn: CSSProperties = { background: '#DC2626', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const overlay: CSSProperties = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 640, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.15)' };

const priLabel: Record<number, string> = { 1: '긴급', 3: '중요', 5: '보통', 9: '낮음' };
const priStyle: Record<number, CSSProperties> = {
  1: { background: '#DC2626', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  3: { background: '#F59E0B', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  5: { background: '#94a3b8', color: '#fff', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
  9: { background: '#e2e8f0', color: '#64748b', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 },
};
const progLabel: Record<number, string> = { 0: '시작 전', 50: '진행 중', 100: '완료' };
const progStyle: Record<number, CSSProperties> = {
  0: { background: '#f1f5f9', color: '#64748b', padding: '2px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 },
  50: { background: '#DBEAFE', color: '#1d4ed8', padding: '2px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 },
  100: { background: '#DCFCE7', color: '#16a34a', padding: '2px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 },
};

function fmtDate(s: string | null): string {
  if (!s) return '';
  try { return new Date(s).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }); } catch { return ''; }
}

export function PlannerTasks() {
  const userId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'incomplete' | 'complete'>('incomplete');
  const [active, setActive] = useState<PlannerTask | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (userId) load(); }, [userId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ tasks: PlannerTask[] }>(`/api/graph-tasks/my-tasks?userId=${userId}`);
      setTasks(res.tasks || []);
    } catch (e: any) {
      setError(e?.message || '태스크 로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function updateProgress(task: PlannerTask, pct: number) {
    setSaving(true);
    try {
      await apiJson(`/api/graph-tasks/${task.id}/progress`, {
        method: 'PATCH',
        body: JSON.stringify({ userId, percentComplete: pct, etag: task.etag }),
      });
      await load();
      if (active?.id === task.id) {
        const updated = tasks.find(t => t.id === task.id);
        if (updated) setActive({ ...updated, percentComplete: pct });
      }
    } catch (e: any) {
      setError(e?.message || '진행률 업데이트 실패');
    } finally {
      setSaving(false);
    }
  }

  async function saveDescription() {
    if (!active) return;
    setSaving(true);
    try {
      await apiJson(`/api/graph-tasks/${active.id}/details`, {
        method: 'PATCH',
        body: JSON.stringify({ userId, description: editDesc, detailsEtag: active.detailsEtag }),
      });
      setActive({ ...active, description: editDesc });
      setEditing(false);
      await load();
    } catch (e: any) {
      setError(e?.message || '설명 저장 실패');
    } finally {
      setSaving(false);
    }
  }

  const filtered = tasks.filter(t => {
    if (filter === 'incomplete') return t.percentComplete < 100;
    if (filter === 'complete') return t.percentComplete === 100;
    return true;
  });

  const plans = [...new Set(filtered.map(t => t.planName || '기타'))];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Teams Planner 태스크</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={filter} onChange={e => setFilter(e.target.value as any)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 13 }}>
            <option value="incomplete">미완료</option>
            <option value="complete">완료</option>
            <option value="all">전체</option>
          </select>
          <button style={primaryBtn} onClick={load} disabled={loading}>{loading ? '로딩…' : '새로고침'}</button>
        </div>
      </div>

      {error && (
        <div style={{ color: '#DC2626', background: '#fef2f2', padding: 12, borderRadius: 8 }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button>
        </div>
      )}

      {loading && !tasks.length ? <div style={{ color: '#94a3b8' }}>로딩중…</div> : (
        plans.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>
            {filter === 'complete' ? '완료된 태스크가 없습니다.' : '배정된 태스크가 없습니다.'}
          </div>
        ) : (
          plans.map(planName => (
            <div key={planName} style={{ display: 'grid', gap: 8 }}>
              <h3 style={{ margin: '8px 0 0', fontSize: 14, color: '#475569' }}>📋 {planName}</h3>
              {filtered.filter(t => (t.planName || '기타') === planName).map(t => {
                const overdue = t.dueDateTime && !t.completedDateTime && new Date(t.dueDateTime) < new Date();
                return (
                  <div
                    key={t.id}
                    style={{ ...card, ...(overdue ? { borderColor: '#fca5a5' } : {}) }}
                    onClick={() => { setActive(t); setEditDesc(t.description); setEditing(false); }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <b style={{ flex: 1, fontSize: 14 }}>{t.title}</b>
                      <span style={priStyle[t.priority] || priStyle[5]}>{priLabel[t.priority] || '보통'}</span>
                      <span style={progStyle[t.percentComplete] || progStyle[0]}>{progLabel[t.percentComplete] || `${t.percentComplete}%`}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#64748b', marginTop: 6, flexWrap: 'wrap' }}>
                      {t.dueDateTime && <span style={overdue ? { color: '#DC2626', fontWeight: 700 } : {}}>기한: {fmtDate(t.dueDateTime)}</span>}
                      {t.startDateTime && <span>시작: {fmtDate(t.startDateTime)}</span>}
                      {Object.keys(t.checklist || {}).length > 0 && (() => {
                        const items = Object.values(t.checklist);
                        const done = items.filter(c => c.isChecked).length;
                        return <span>체크리스트: {done}/{items.length}</span>;
                      })()}
                    </div>
                    {t.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500 }}>{t.description}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                      {t.percentComplete !== 50 && <button style={ghostBtn} onClick={() => updateProgress(t, 50)} disabled={saving}>진행 중</button>}
                      {t.percentComplete !== 100 && <button style={{ ...ghostBtn, borderColor: '#16a34a', color: '#16a34a' }} onClick={() => updateProgress(t, 100)} disabled={saving}>완료</button>}
                      {t.percentComplete === 100 && <button style={{ ...ghostBtn, borderColor: '#f59e0b', color: '#f59e0b' }} onClick={() => updateProgress(t, 0)} disabled={saving}>다시 열기</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )
      )}

      {/* Detail Modal */}
      {active && (
        <div style={overlay} onClick={() => setActive(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <h2 style={{ margin: 0, flex: 1, fontSize: 18 }}>{active.title}</h2>
              <button style={ghostBtn} onClick={() => setActive(null)}>닫기</button>
            </div>

            <div style={{ display: 'grid', gap: 8, fontSize: 13, color: '#475569', marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <span>플랜: <b>{active.planName || '-'}</b></span>
                <span>우선순위: <span style={priStyle[active.priority] || priStyle[5]}>{priLabel[active.priority] || '보통'}</span></span>
                <span>상태: <span style={progStyle[active.percentComplete] || progStyle[0]}>{progLabel[active.percentComplete] || `${active.percentComplete}%`}</span></span>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {active.startDateTime && <span>시작일: {fmtDate(active.startDateTime)}</span>}
                {active.dueDateTime && <span>기한: {fmtDate(active.dueDateTime)}</span>}
                {active.completedDateTime && <span>완료일: {fmtDate(active.completedDateTime)}</span>}
              </div>
            </div>

            {/* Progress update */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>진행 상태 변경</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[
                  { pct: 0, label: '시작 전', bg: '#f1f5f9', fg: '#64748b' },
                  { pct: 50, label: '진행 중', bg: '#DBEAFE', fg: '#1d4ed8' },
                  { pct: 100, label: '완료', bg: '#DCFCE7', fg: '#16a34a' },
                ].map(opt => (
                  <button
                    key={opt.pct}
                    style={{
                      padding: '8px 20px', borderRadius: 8, border: '2px solid', cursor: 'pointer', fontWeight: 700, fontSize: 14,
                      background: active.percentComplete === opt.pct ? opt.bg : '#fff',
                      color: opt.fg,
                      borderColor: active.percentComplete === opt.pct ? opt.fg : '#e5e7eb',
                    }}
                    disabled={saving || active.percentComplete === opt.pct}
                    onClick={async () => {
                      await updateProgress(active, opt.pct);
                      setActive({ ...active, percentComplete: opt.pct });
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Description / Result */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>설명 / 결과 입력</h3>
                {!editing && <button style={ghostBtn} onClick={() => { setEditDesc(active.description); setEditing(true); }}>편집</button>}
                {editing && (
                  <>
                    <button style={primaryBtn} onClick={saveDescription} disabled={saving}>{saving ? '저장중…' : '저장'}</button>
                    <button style={ghostBtn} onClick={() => setEditing(false)}>취소</button>
                  </>
                )}
              </div>
              {editing ? (
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  style={{ width: '100%', minHeight: 160, borderRadius: 8, border: '1px solid #CBD5E1', padding: 12, fontSize: 14, fontFamily: 'inherit', lineHeight: 1.6 }}
                  placeholder="태스크 결과, 진행 내용, 메모 등을 입력하세요..."
                />
              ) : active.description ? (
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.7, color: '#1e293b' }}>{active.description}</div>
              ) : (
                <div style={{ color: '#94a3b8', fontSize: 13 }}>설명이 없습니다. "편집" 버튼을 눌러 결과를 입력하세요.</div>
              )}
            </div>

            {/* Checklist */}
            {Object.keys(active.checklist || {}).length > 0 && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>체크리스트</h3>
                <div style={{ display: 'grid', gap: 6 }}>
                  {Object.entries(active.checklist).map(([key, item]) => (
                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                      <span style={{ fontSize: 16 }}>{item.isChecked ? '☑' : '☐'}</span>
                      <span style={item.isChecked ? { textDecoration: 'line-through', color: '#94a3b8' } : {}}>{item.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
