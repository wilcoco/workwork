import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

type WeeklySections = {
  completedTasks: string[];
  ongoingProjects: string[];
  risksAndIssues: string[];
  nextWeekPlan: string[];
  supportRequests: string[];
};

const EMPTY_SECTIONS: WeeklySections = {
  completedTasks: [''],
  ongoingProjects: [''],
  risksAndIssues: [],
  nextWeekPlan: [''],
  supportRequests: [],
};

function getMonday(d: Date): string {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff);
  return dt.toISOString().slice(0, 10);
}

const S: Record<string, React.CSSProperties> = {
  input: { border: '1px solid #CBD5E1', background: '#FFFFFF', borderRadius: 10, padding: '10px 12px', outline: 'none', width: '100%', fontSize: 13 },
  sectionTitle: { fontWeight: 700, fontSize: 14, color: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  pill: { fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 600 },
  card: { border: '1px solid #E5E7EB', borderRadius: 12, padding: 16, background: '#fff' },
};

export function WeeklyReport() {
  const userId = localStorage.getItem('userId') || '';
  const [weekStart, setWeekStart] = useState(getMonday(new Date()));
  const [sections, setSections] = useState<WeeklySections>({ ...EMPTY_SECTIONS });
  const [status, setStatus] = useState<'DRAFT' | 'CONFIRMED'>('DRAFT');
  const [reportId, setReportId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [orgUsers, setOrgUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(userId);
  const [me, setMe] = useState<any>(null);

  // Load current user info
  useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const u = await apiJson<any>(`/api/users/me?userId=${encodeURIComponent(userId)}`);
        setMe(u);
        // If manager/exec/ceo, load team members
        if (['CEO', 'EXEC', 'MANAGER'].includes(u.role)) {
          const users = await apiJson<{ items: any[] }>('/api/users');
          setOrgUsers(users.items || []);
        }
      } catch {}
    })();
  }, [userId]);

  // Load report for selected week
  useEffect(() => {
    if (!selectedUserId || !weekStart) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/weekly-reports?userId=${encodeURIComponent(selectedUserId)}&from=${weekStart}&to=${weekStart}&limit=1`);
        const item = res.items?.[0];
        if (item) {
          setReportId(item.id);
          setSections(item.sections || { ...EMPTY_SECTIONS });
          setStatus(item.status || 'DRAFT');
        } else {
          setReportId(null);
          setSections({ ...EMPTY_SECTIONS });
          setStatus('DRAFT');
        }
      } catch (e: any) {
        setError(e?.message || '불러오기 실패');
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedUserId, weekStart]);

  // Load recent history
  useEffect(() => {
    if (!selectedUserId) return;
    (async () => {
      try {
        const res = await apiJson<{ items: any[] }>(`/api/weekly-reports?userId=${encodeURIComponent(selectedUserId)}&limit=10`);
        setHistory(res.items || []);
      } catch {}
    })();
  }, [selectedUserId, saving]);

  async function aiGenerate() {
    setAiLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ sections?: WeeklySections; message?: string }>('/api/weekly-reports/ai-generate', {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId, weekStart }),
      });
      if (res.sections) {
        setSections({
          completedTasks: res.sections.completedTasks?.length ? res.sections.completedTasks : [''],
          ongoingProjects: res.sections.ongoingProjects?.length ? res.sections.ongoingProjects : [''],
          risksAndIssues: res.sections.risksAndIssues || [],
          nextWeekPlan: res.sections.nextWeekPlan?.length ? res.sections.nextWeekPlan : [''],
          supportRequests: res.sections.supportRequests || [],
        });
        setSuccess('AI 자동 집계 완료');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(res.message || 'AI 집계 결과가 없습니다.');
      }
    } catch (e: any) {
      setError(e?.message || 'AI 집계 실패');
    } finally {
      setAiLoading(false);
    }
  }

  async function save(newStatus?: 'DRAFT' | 'CONFIRMED') {
    setSaving(true);
    setError(null);
    try {
      const finalStatus = newStatus || status;
      const res = await apiJson<any>('/api/weekly-reports', {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserId, weekStart, sections, status: finalStatus }),
      });
      setReportId(res.id);
      setStatus(finalStatus);
      setSuccess(finalStatus === 'CONFIRMED' ? '주간 리포트가 확정되었습니다.' : '저장되었습니다.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  function updateSection(key: keyof WeeklySections, idx: number, value: string) {
    setSections(prev => {
      const arr = [...(prev[key] as string[])];
      arr[idx] = value;
      return { ...prev, [key]: arr };
    });
  }

  function addSectionItem(key: keyof WeeklySections) {
    setSections(prev => ({ ...prev, [key]: [...(prev[key] as string[]), ''] }));
  }

  function removeSectionItem(key: keyof WeeklySections, idx: number) {
    setSections(prev => {
      const arr = (prev[key] as string[]).filter((_, i) => i !== idx);
      return { ...prev, [key]: arr.length ? arr : [''] };
    });
  }

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d.toISOString().slice(0, 10));
  }

  const weekEndDate = (() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  })();

  const isManager = me && ['CEO', 'EXEC', 'MANAGER'].includes(me.role);

  function renderSectionEditor(title: string, key: keyof WeeklySections, placeholder: string, color: string) {
    const items = (sections[key] as string[]) || [];
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={S.sectionTitle}>
          <div style={{ color }}>{title}</div>
          <button type="button" className="btn btn-sm btn-outline" style={{ fontSize: 11 }}
            onClick={() => addSectionItem(key)}>+ 추가</button>
        </div>
        {items.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>항목 없음</div>}
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'start' }}>
            <input value={item} onChange={e => updateSection(key, i, e.target.value)}
              placeholder={placeholder} style={S.input} />
            {items.length > 1 && (
              <button type="button" onClick={() => removeSectionItem(key, i)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#b91c1c', fontSize: 14, padding: '8px 4px', flexShrink: 0 }}>✕</button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="content" style={{ display: 'grid', gap: 16, maxWidth: 800, margin: '24px auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>주간 업무 리포트</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-sm btn-ghost" onClick={prevWeek}>◀</button>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#334155', minWidth: 200, textAlign: 'center' as any }}>
            {weekStart} ~ {weekEndDate}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={nextWeek}>▶</button>
        </div>
      </div>

      {isManager && orgUsers.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>작성자:</div>
          <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
            style={{ ...S.input, width: 'auto', appearance: 'auto' as any }}>
            {orgUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </select>
        </div>
      )}

      {error && <div style={{ color: '#b91c1c', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{error}</div>}
      {success && <div style={{ color: '#166534', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '8px 12px', fontSize: 13 }}>{success}</div>}

      {loading ? (
        <div style={{ textAlign: 'center' as any, padding: 40, color: '#64748b' }}>불러오는 중...</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ ...S.pill, background: status === 'CONFIRMED' ? '#DCFCE7' : '#FEF9C3', color: status === 'CONFIRMED' ? '#166534' : '#92400e' }}>
                {status === 'CONFIRMED' ? '확정' : '작성중'}
              </span>
              {reportId && <span style={{ fontSize: 11, color: '#94a3b8' }}>ID: {reportId.slice(0, 8)}</span>}
            </div>
            <button type="button" className="btn btn-sm" onClick={aiGenerate} disabled={aiLoading}
              style={{ background: '#0F3D73', color: '#fff', fontWeight: 700 }}>
              {aiLoading ? 'AI 집계 중...' : 'AI 자동 집계'}
            </button>
          </div>

          <div style={S.card}>
            <div style={{ display: 'grid', gap: 16 }}>
              {renderSectionEditor('1. 이번 주 주요 완료 업무', 'completedTasks', '완료된 업무를 입력하세요', '#166534')}
              {renderSectionEditor('2. 진행 중 핵심 프로젝트', 'ongoingProjects', '진행 중인 프로젝트를 입력하세요', '#1e40af')}
              {renderSectionEditor('3. 문제 / 리스크', 'risksAndIssues', '문제점이나 리스크를 입력하세요', '#b91c1c')}
              {renderSectionEditor('4. 다음 주 계획', 'nextWeekPlan', '다음 주 계획을 입력하세요', '#0f172a')}
              {renderSectionEditor('5. 지원 요청 사항', 'supportRequests', '지원이 필요한 사항을 입력하세요', '#7c3aed')}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => { setSections({ ...EMPTY_SECTIONS }); setStatus('DRAFT'); }}>
              초기화
            </button>
            <button type="button" className="btn btn-sm" onClick={() => save('DRAFT')} disabled={saving}>
              {saving ? '저장 중...' : '임시 저장'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => save('CONFIRMED')} disabled={saving}>
              {saving ? '확정 중...' : '확정'}
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#334155', marginBottom: 12 }}>최근 주간 리포트</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {history.map(h => {
              const ws = new Date(h.weekStart);
              const we = new Date(ws.getTime() + 6 * 24 * 60 * 60 * 1000);
              const isSelected = h.weekStart?.slice?.(0, 10) === weekStart || new Date(h.weekStart).toISOString().slice(0, 10) === weekStart;
              return (
                <div key={h.id}
                  onClick={() => setWeekStart(new Date(h.weekStart).toISOString().slice(0, 10))}
                  style={{
                    ...S.card,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    border: isSelected ? '2px solid #0F3D73' : '1px solid #E5E7EB',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {ws.toISOString().slice(0, 10)} ~ {we.toISOString().slice(0, 10)}
                    </span>
                    {h.user && <span style={{ fontSize: 12, color: '#64748b' }}>{h.user.name}</span>}
                  </div>
                  <span style={{ ...S.pill, background: h.status === 'CONFIRMED' ? '#DCFCE7' : '#FEF9C3', color: h.status === 'CONFIRMED' ? '#166534' : '#92400e' }}>
                    {h.status === 'CONFIRMED' ? '확정' : '작성중'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
