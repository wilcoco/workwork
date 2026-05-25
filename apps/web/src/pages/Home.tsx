import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson, apiUrl } from '../lib/api';
import { formatKstDatetime, formatKstYmd } from '../lib/time';
import { WorklogDocument } from '../components/WorklogDocument';
import { UserAvatar } from '../components/UserAvatar';

type WL = { id: string; userId?: string; title: string; excerpt: string; userName?: string; teamName?: string; date: string; createdAt?: string; visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY' };
type FB = { id: string; subjectId: string; authorId?: string; authorName?: string; authorTeam?: string | null; content: string; createdAt: string };

const VISIBILITY_LABEL: Record<string, string> = {
  ALL: '전체',
  MANAGER_PLUS: '팀장이상',
  EXEC_PLUS: '임원이상',
  CEO_ONLY: '대표이사',
};

function visibilityKo(v: any): string {
  const key = String(v || 'ALL');
  return VISIBILITY_LABEL[key] || key;
}

function fmtDatetime(createdAt: any, date: any): string {
  const src = createdAt || date;
  if (!src) return '';
  const d = new Date(src);
  if (isNaN(d.getTime())) return String(src);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function Home() {
  const nav = useNavigate();
  const [worklogs, setWorklogs] = useState<WL[]>([]);
  const [urgentWls, setUrgentWls] = useState<WL[]>([]);
  const [comments, setComments] = useState<FB[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overdueTasks, setOverdueTasks] = useState<any[]>([]);
  // 알림 배너용 상태
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [pendingInstructions, setPendingInstructions] = useState<any[]>([]);
  const [pendingComments, setPendingComments] = useState<any[]>([]); // 내 업무일지에 달린 답변 필요한 댓글
  const [overdueScope, setOverdueScope] = useState<'mine' | 'all'>('mine');
  const [overdueYear, setOverdueYear] = useState<'2026' | 'before' | 'all'>('2026');
  const [overdueLoading, setOverdueLoading] = useState(false);
  const [expandedOverdueUser, setExpandedOverdueUser] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailFull, setDetailFull] = useState<any | null>(null);
  useEffect(() => {
    if (!detail?.id) { setDetailFull(null); return; }
    setDetailFull(null);
    apiJson<any>(`/api/worklogs/${detail.id}`).then(setDetailFull).catch(() => setDetailFull(null));
  }, [detail?.id]);

  const [urgentOpen, setUrgentOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [mainTab, setMainTab] = useState<'worklogs' | 'comments'>('comments');
  const [filterDept, setFilterDept] = useState(''); // 실(부서) 필터
  const [filterTeam, setFilterTeam] = useState('');
  const [filterName, setFilterName] = useState('');
  // 실(부서) 목록
  const DEPT_LIST = ['경영관리실', '연구개발실', '생산실', '함평공장', '품질경영실'];
  // 팀 목록 (고정)
  const TEAM_LIST = ['생산팀', '생산기술팀', '양산품질팀', '상생협력팀', '자재관리팀', '영업관리팀', '경영관리팀', '전산팀', '함평팀', '에스콘', '설계팀', '개발팀'];
  const [viewMode, setViewMode] = useState<'summary'|'full'>('full');
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<'urgent' | 'worklogs' | 'comments'>('worklogs');
  const WORKLOG_PAGE_SIZE = 20;
  const [worklogPage, setWorklogPage] = useState(1);
  const [worklogTotal, setWorklogTotal] = useState(0);
  // Like summary for the currently displayed worklog page: { worklogId: {count, liked} }
  const [likeMap, setLikeMap] = useState<Record<string, { count: number; liked: boolean }>>({});
  // Team/name filter options come from a one-time sample fetch so the
  // dropdowns are not limited to the current page's entries.
  const [facetSample, setFacetSample] = useState<WL[]>([]);
  // All teams from org units API (not just those with worklogs)
  const [allTeams, setAllTeams] = useState<string[]>([]);
  // 전체 사용자 목록 (조직도 기반)
  const [allUsers, setAllUsers] = useState<Array<{ name: string; teamName: string }>>([]);
  const teamOptions = TEAM_LIST; // 고정 팀 목록
  const deptOptions = DEPT_LIST; // 고정 실 목록
  const nameOptions = useMemo(() => {
    // 조직도 기반 전체 사용자에서 필터링
    let filtered = allUsers;
    if (filterTeam) {
      filtered = allUsers.filter(u => u.teamName === filterTeam);
    }
    return filtered.map(u => u.name).sort();
  }, [allUsers, filterTeam]);
  const latestComments = useMemo(() => {
    const map = new Map<string, { c: FB; t: number }>();
    comments.forEach(c => {
      const t = new Date(c.createdAt).getTime();
      const cur = map.get(c.subjectId);
      if (!cur || t > cur.t) map.set(c.subjectId, { c, t });
    });
    return Array.from(map.values()).sort((a,b) => b.t - a.t).map(x => x.c);
  }, [comments]);

  // The worklogs list is now server-paginated, so treat the fetched page as
  // the view directly. We keep the (team|name) filter in sync with server
  // query params below.
  const pagedWorklogs = worklogs;
  const filteredWorklogs = worklogs; // legacy name used by empty-state check
  const totalWorklogPages = Math.max(1, Math.ceil(worklogTotal / WORKLOG_PAGE_SIZE));
  // Reset to first page when filters change
  useEffect(() => {
    setWorklogPage(1);
  }, [filterDept, filterTeam, filterName]);

  // When the team/dept filter changes, clear the selected name if it no longer
  // belongs to the selected team's member list.
  useEffect(() => {
    if ((!filterDept && !filterTeam) || !filterName) return;
    if (!nameOptions.includes(filterName)) setFilterName('');
  }, [filterDept, filterTeam, nameOptions]);

  useEffect(() => {
    const update = () => {
      if (typeof window === 'undefined') return;
      setIsMobile(window.innerWidth < 768);
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', update);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', update);
      }
    };
  }, []);

  // Fetch the current page of worklogs whenever filters or page change.
  useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
        const offset = (worklogPage - 1) * WORKLOG_PAGE_SIZE;
        const params = new URLSearchParams();
        params.set('limit', String(WORKLOG_PAGE_SIZE));
        params.set('offset', String(offset));
        params.set('withTotal', '1');
        if (viewerId) params.set('viewerId', viewerId);
        if (filterDept.trim()) params.set('dept', filterDept.trim());
        if (filterTeam.trim()) params.set('team', filterTeam.trim());
        if (filterName.trim()) params.set('user', filterName.trim());
        const wl = await apiJson<{ items: WL[]; total?: number }>(`/api/worklogs/search?${params.toString()}`);
        if (ignore) return;
        setWorklogs(wl.items || []);
        if (typeof wl.total === 'number') setWorklogTotal(wl.total);
        // Batch-fetch like summary for the visible page.
        try {
          const ids = (wl.items || []).map((x: any) => x.id).filter(Boolean);
          if (ids.length) {
            const res = await apiJson<{ items: Record<string, { count: number; liked: boolean }> }>(
              '/api/likes/by-subjects',
              {
                method: 'POST',
                body: JSON.stringify({ subjectType: 'Worklog', ids, viewerId }),
              },
            );
            if (!ignore) setLikeMap(res.items || {});
          } else if (!ignore) {
            setLikeMap({});
          }
        } catch {
          if (!ignore) setLikeMap({});
        }
      } catch (e: any) {
        if (!ignore) setError('업무일지 로드 실패');
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [worklogPage, filterDept, filterTeam, filterName]);

  // Urgent worklogs and facet sample (for filter dropdowns): fetched once.
  useEffect(() => {
    (async () => {
      try {
        const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
        const uwQs = viewerId ? `limit=20&urgent=true&viewerId=${encodeURIComponent(viewerId)}` : 'limit=20&urgent=true';
        const uw = await apiJson<{ items: WL[] }>(`/api/worklogs/search?${uwQs}`);
        setUrgentWls(uw.items || []);
      } catch {}
      try {
        const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
        const fs = await apiJson<{ items: WL[] }>(
          `/api/worklogs/search?limit=200${viewerId ? `&viewerId=${encodeURIComponent(viewerId)}` : ''}`,
        );
        setFacetSample(fs.items || []);
      } catch {}
      // Fetch all org units (teams) so the team filter shows ALL teams, not just those with worklogs
      try {
        const orgs = await apiJson<{ items: Array<{ id: string; name: string }> }>('/api/orgs');
        const names = (orgs.items || []).map((o) => o.name).filter(Boolean);
        setAllTeams(names);
      } catch {}
      // 전체 사용자 목록 가져오기 (조직도 기반)
      try {
        const usersRes = await apiJson<{ items: Array<{ name: string; orgUnit?: { name: string } }> }>('/api/users');
        const userList = (usersRes.items || []).map((u: any) => ({
          name: u.name || '',
          teamName: u.orgUnit?.name || u.orgName || '',
        })).filter((u: any) => u.name);
        setAllUsers(userList);
      } catch {}
    })();
  }, []);

  // Sync user's Planner tasks to DB cache on first load, then fetch overdue from cache
  const [tasksSynced, setTasksSynced] = useState(false);
  useEffect(() => {
    (async () => {
      const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
      if (!viewerId) return;
      // Sync own tasks to cache (once per page load)
      if (!tasksSynced) {
        try {
          await apiJson('/api/graph-tasks/sync-my-tasks', {
            method: 'POST',
            body: JSON.stringify({ userId: viewerId }),
          });
        } catch {}
        setTasksSynced(true);
      }
      // Then fetch overdue tasks from DB cache
      setOverdueLoading(true);
      try {
        const res = await apiJson<{ tasks: any[] }>(`/api/graph-tasks/overdue-tasks?userId=${encodeURIComponent(viewerId)}&scope=${overdueScope}`);
        setOverdueTasks(res.tasks || []);
      } catch {
        setOverdueTasks([]);
      } finally {
        setOverdueLoading(false);
      }
    })();
  }, [overdueScope, tasksSynced]);

  useEffect(() => {
    (async () => {
      try {
        const fb = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=Worklog&limit=60`);
        setComments((fb.items || []).map((x: any) => ({ id: x.id, subjectId: x.subjectId, authorId: x.authorId, authorName: x.authorName, authorTeam: x.authorTeam ?? null, content: x.content, createdAt: x.createdAt })));
      } catch {
        // ignore
      }
    })();
  }, []);

  // Total pending approvals count (for banner display)
  const [pendingApprovalsTotal, setPendingApprovalsTotal] = useState<number>(0);

  // 알림 배너: 대기 중인 결재, 업무 지시, 내 업무일지 댓글 조회
  useEffect(() => {
    const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
    if (!viewerId) return;
    (async () => {
      // 내가 결재해야 할 건 (현재 내 차례인 것만, 최대 3건 표시 + 총 건수)
      try {
        const res = await apiJson<{ items: any[]; total?: number }>(`/api/approvals?approverId=${encodeURIComponent(viewerId)}&status=PENDING&currentApproverOnly=true&withTotal=1&limit=3`);
        setPendingApprovals(res.items || []);
        setPendingApprovalsTotal(res.total ?? res.items?.length ?? 0);
      } catch {
        setPendingApprovals([]);
        setPendingApprovalsTotal(0);
      }
      // 나에게 온 업무 지시 (미완료)
      try {
        const res = await apiJson<{ items: any[] }>(`/api/instructions?assigneeId=${encodeURIComponent(viewerId)}&status=OPEN&limit=10`);
        setPendingInstructions(res.items || []);
      } catch {
        setPendingInstructions([]);
      }
      // 나에게 온 댓글 알림 (읽지 않은 것)
      try {
        const res = await apiJson<{ items: any[] }>(`/api/inbox?userId=${encodeURIComponent(viewerId)}&type=FeedbackAdded&onlyUnread=true&limit=20`);
        setPendingComments(res.items || []);
      } catch {
        setPendingComments([]);
      }
    })();
  }, []);

  if (loading && !worklogs.length) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200, color: '#64748b', fontWeight: 600 }}>
        불러오는 중…
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* 알림 배너 */}
      {(pendingApprovalsTotal > 0 || pendingInstructions.length > 0 || pendingComments.length > 0) && (
        <div style={{ background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)', border: '1px solid #f59e0b', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🔔</span>
            <span style={{ fontWeight: 800, color: '#92400e', fontSize: 15 }}>처리가 필요한 항목이 있습니다</span>
          </div>
          {pendingApprovalsTotal > 0 && (
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 700, color: '#b45309', marginBottom: 6, fontSize: 13 }}>📋 결재 대기 ({pendingApprovalsTotal}건)</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {pendingApprovals.slice(0, 3).map((a: any) => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: '#78350f' }}>• {a.requestedBy?.name || '신청자'}</span>
                    <span style={{ color: '#92400e', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.subjectType === 'CAR_DISPATCH' && '[배차]'}
                      {a.subjectType === 'LOGISTICS_DISPATCH' && '[물류배차]'}
                      {a.subjectType === 'ATTENDANCE' && '[근태]'}
                      {a.subjectType === 'BUSINESS_TRIP' && '[출장]'}
                      {a.subjectType === 'Worklog' && '[업무일지]'}
                      {a.subjectType === 'PROCESS' && '[프로세스]'}
                    </span>
                    <span style={{ fontSize: 11, color: '#a16207' }}>{new Date(a.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
                {pendingApprovalsTotal > 3 && (
                  <div style={{ fontSize: 12, color: '#a16207' }}>외 {pendingApprovalsTotal - 3}건 더...</div>
                )}
              </div>
              <button
                onClick={() => nav('/approvals/inbox')}
                style={{ marginTop: 8, background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
              >
                결재하기 →
              </button>
            </div>
          )}
          {pendingComments.length > 0 && (
            <div style={{ background: '#eff6ff', border: '1px solid #93c5fd', borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: 6, fontSize: 13 }}>💬 내게 온 댓글 ({pendingComments.length}건) - 답변하기</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {pendingComments.slice(0, 3).map((n: any) => {
                  const fb = n._feedback || {};
                  return (
                    <div
                      key={n.id}
                      onClick={async () => {
                        if (!n.subjectId) return;
                        try {
                          const wl = await apiJson<any>(`/api/worklogs/${encodeURIComponent(n.subjectId)}`);
                          setDetail(wl);
                          // Mark notification as read
                          apiJson(`/api/notifications/${n.id}/read`, { method: 'POST', body: JSON.stringify({ actorId: localStorage.getItem('userId') || '' }) }).catch(() => {});
                        } catch {
                          alert('업무일지를 불러올 수 없습니다');
                        }
                      }}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: '#fff' }}
                    >
                      <span style={{ color: '#1e40af', fontWeight: 600 }}>• {fb.authorName || '작성자'}</span>
                      <span style={{ color: '#1e3a8a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {(fb.content || '').slice(0, 30)}{(fb.content || '').length > 30 ? '...' : ''}
                      </span>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>{new Date(n.createdAt).toLocaleDateString()}</span>
                      <span style={{ fontSize: 11, color: '#9ca3af' }}>답변 →</span>
                    </div>
                  );
                })}
                {pendingComments.length > 3 && (
                  <div style={{ fontSize: 12, color: '#1d4ed8' }}>외 {pendingComments.length - 3}건 더...</div>
                )}
              </div>
            </div>
          )}
          {pendingInstructions.length > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 700, color: '#b91c1c', marginBottom: 6, fontSize: 13 }}>📌 업무 지시 ({pendingInstructions.length}건) - 업무일지 작성으로 완료</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {pendingInstructions.slice(0, 3).map((ins: any) => (
                  <div
                    key={ins.id}
                    onClick={() => nav(`/quick?instructionId=${encodeURIComponent(ins.id)}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: '#fff' }}
                  >
                    <span style={{ color: '#7f1d1d', fontWeight: 600 }}>• {ins.assignerName || '지시자'}</span>
                    <span style={{ color: '#991b1b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ins.title || '업무 지시'}
                    </span>
                    {ins.dueDate && (
                      <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>마감 {new Date(ins.dueDate).toLocaleDateString()}</span>
                    )}
                    <span style={{ fontSize: 11, color: '#9ca3af' }}>업무일지 작성 →</span>
                  </div>
                ))}
                {pendingInstructions.length > 3 && (
                  <div style={{ fontSize: 12, color: '#b91c1c' }}>외 {pendingInstructions.length - 3}건 더...</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 10, padding: '8px 0', marginBottom: 8, borderBottom: '1px solid #e2e8f0' }}>
        <select value={filterDept} onChange={(e) => { setFilterDept(e.target.value); setFilterTeam(''); }} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '4px 8px', height: 34, width: isMobile ? '100%' : 120, maxWidth: isMobile ? '100%' : undefined, appearance: 'auto' as any }}>
          <option value="">실 전체</option>
          {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '4px 8px', height: 34, width: isMobile ? '100%' : 140, maxWidth: isMobile ? '100%' : undefined, appearance: 'auto' as any }}>
          <option value="">팀 전체</option>
          {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterName} onChange={(e) => setFilterName(e.target.value)} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '4px 8px', height: 34, width: isMobile ? '100%' : 140, maxWidth: isMobile ? '100%' : undefined, appearance: 'auto' as any }}>
          <option value="">이름 전체</option>
          {nameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{ marginLeft: isMobile ? 0 : 'auto', display: 'flex', gap: 6, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'flex-end' : 'flex-start' }}>
          <button className={viewMode==='summary' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('summary')} style={{ height: 34, padding: '0 14px', minWidth: 100, whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}>요약</button>
          <button className={viewMode==='full' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('full')} style={{ height: 34, padding: '0 14px', minWidth: 100, whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}>전체</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}

      {/* 기한 경과 과제 섹션 - 숨김 */}
      {false && (() => {
        const filteredOverdue = overdueTasks.filter((t: any) => {
          if (overdueYear === 'all') return true;
          const d = new Date(t.dueDateTime);
          if (isNaN(d.getTime())) return false;
          const y = d.getFullYear();
          if (overdueYear === '2026') return y === 2026;
          if (overdueYear === 'before') return y < 2026;
          return true;
        });
        return (
      <div style={{ background: filteredOverdue.length ? '#fef2f2' : '#f8fafc', border: `1px solid ${filteredOverdue.length ? '#fca5a5' : '#CBD5E1'}`, borderRadius: 12, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: filteredOverdue.length || overdueLoading ? 10 : 0, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 800, color: filteredOverdue.length ? '#dc2626' : '#334155', fontSize: 15 }}>
            기한 경과 과제 {filteredOverdue.length > 0 && <span style={{ fontSize: 13, fontWeight: 600 }}>({filteredOverdue.length}건{overdueYear !== 'all' ? ` / 전체 ${overdueTasks.length}건` : ''})</span>}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className={overdueYear === '2026' ? 'btn btn-primary' : 'btn'}
                onClick={() => setOverdueYear('2026')}
                style={{ height: 28, padding: '0 10px', fontSize: 12, minWidth: 0, whiteSpace: 'nowrap' }}
                title="2026년에 완료해야 할 과제"
              >2026년</button>
              <button
                className={overdueYear === 'before' ? 'btn btn-primary' : 'btn'}
                onClick={() => setOverdueYear('before')}
                style={{ height: 28, padding: '0 10px', fontSize: 12, minWidth: 0, whiteSpace: 'nowrap' }}
                title="2025년 이전"
              >이전</button>
              <button
                className={overdueYear === 'all' ? 'btn btn-primary' : 'btn'}
                onClick={() => setOverdueYear('all')}
                style={{ height: 28, padding: '0 10px', fontSize: 12, minWidth: 0, whiteSpace: 'nowrap' }}
              >전체</button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className={overdueScope === 'mine' ? 'btn btn-primary' : 'btn'}
                onClick={() => setOverdueScope('mine')}
                style={{ height: 28, padding: '0 10px', fontSize: 12, minWidth: 0, whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}
              >내 과제</button>
              <button
                className={overdueScope === 'all' ? 'btn btn-primary' : 'btn'}
                onClick={() => setOverdueScope('all')}
                style={{ height: 28, padding: '0 10px', fontSize: 12, minWidth: 0, whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}
              >전사 과제</button>
            </div>
          </div>
        </div>
        {overdueLoading ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>불러오는 중…</div>
        ) : filteredOverdue.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>{
            overdueYear === '2026' ? '2026년에 완료해야 할 기한 경과 과제가 없습니다.' :
            overdueYear === 'before' ? '2025년 이전 기한의 경과 과제가 없습니다.' :
            overdueScope === 'mine' ? '기한 경과된 과제가 없습니다.' : '전사 기한 경과 과제가 없습니다.'
          }</div>
        ) : overdueScope === 'mine' ? (
          /* ── 내 과제: 플랫 리스트 ── */
          <div style={{ display: 'grid', gap: 6 }}>
            {filteredOverdue.map((t: any) => {
              const daysOver = Math.floor((Date.now() - new Date(t.dueDateTime).getTime()) / (24 * 60 * 60 * 1000));
              const priorityLabel: Record<number, string> = { 1: '긴급', 3: '중요', 5: '보통', 9: '낮음' };
              const priorityColor: Record<number, string> = { 1: '#dc2626', 3: '#ea580c', 5: '#64748b', 9: '#94a3b8' };
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fff', borderRadius: 8, border: '1px solid #fecaca', fontSize: 13 }}>
                  <span style={{ color: priorityColor[t.priority] || '#64748b', fontWeight: 700, fontSize: 11, minWidth: 32 }}>
                    {priorityLabel[t.priority] || ''}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 100 }}>{t.title}</span>
                  <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {daysOver}일 초과
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                    {new Date(t.dueDateTime).toLocaleDateString('ko-KR')}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── 전사 과제: 개인별 그룹 아코디언 ── */
          (() => {
            const grouped: Record<string, { name: string; team: string; tasks: any[] }> = {};
            filteredOverdue.forEach((t: any) => {
              const key = t.assigneeName || '미배정';
              if (!grouped[key]) grouped[key] = { name: key, team: t.assigneeTeam || '', tasks: [] };
              grouped[key].tasks.push(t);
            });
            const people = Object.values(grouped).sort((a, b) => b.tasks.length - a.tasks.length);
            return (
              <div style={{ display: 'grid', gap: 4 }}>
                {people.map((p) => {
                  const isOpen = expandedOverdueUser === p.name;
                  const maxDaysOver = Math.max(...p.tasks.map((t: any) => Math.floor((Date.now() - new Date(t.dueDateTime).getTime()) / (24 * 60 * 60 * 1000))));
                  return (
                    <div key={p.name}>
                      <div
                        onClick={() => setExpandedOverdueUser(isOpen ? null : p.name)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fff', borderRadius: 8, border: '1px solid #fecaca', fontSize: 13, cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ fontSize: 12, color: '#64748b', width: 16, textAlign: 'center' }}>{isOpen ? '▾' : '▸'}</span>
                        <span style={{ fontWeight: 700, minWidth: 60 }}>{p.name}</span>
                        {p.team && <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.team}</span>}
                        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#dc2626', fontWeight: 700 }}>
                          {p.tasks.length}건
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                          최대 {maxDaysOver}일 초과
                        </span>
                      </div>
                      {isOpen && (
                        <div style={{ display: 'grid', gap: 4, paddingLeft: 24, paddingTop: 4 }}>
                          {p.tasks.map((t: any) => {
                            const daysOver = Math.floor((Date.now() - new Date(t.dueDateTime).getTime()) / (24 * 60 * 60 * 1000));
                            const priorityLabel: Record<number, string> = { 1: '긴급', 3: '중요', 5: '보통', 9: '낮음' };
                            const priorityColor: Record<number, string> = { 1: '#dc2626', 3: '#ea580c', 5: '#64748b', 9: '#94a3b8' };
                            return (
                              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#fff7f7', borderRadius: 6, border: '1px solid #fee2e2', fontSize: 12 }}>
                                <span style={{ color: priorityColor[t.priority] || '#64748b', fontWeight: 700, fontSize: 11, minWidth: 32 }}>
                                  {priorityLabel[t.priority] || ''}
                                </span>
                                <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                                {t.planName && <span style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>{t.planName}</span>}
                                <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                  {daysOver}일
                                </span>
                                <span style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                  {new Date(t.dueDateTime).toLocaleDateString('ko-KR')}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>
        );
      })()}

      <div style={{ display: 'grid', gap: 12 }}>
        {isMobile ? (
          <>
            {/* 모바일: 긴급 보고 / 최근 댓글 먼저, 그 다음 최근 업무일지 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={mobileTab==='urgent' ? 'btn btn-primary' : 'btn'} onClick={() => setMobileTab('urgent')} style={{ flex: 1, height: 34, padding: '0 10px', whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}>긴급 보고</button>
              <button className={mobileTab==='worklogs' ? 'btn btn-primary' : 'btn'} onClick={() => setMobileTab('worklogs')} style={{ flex: 1, height: 34, padding: '0 10px', whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}>최근 업무일지</button>
              <button className={mobileTab==='comments' ? 'btn btn-primary' : 'btn'} onClick={() => setMobileTab('comments')} style={{ flex: 1, height: 34, padding: '0 10px', whiteSpace: 'nowrap', writingMode: 'horizontal-tb' as any }}>최근 댓글</button>
            </div>
            {mobileTab !== 'worklogs' && (
            <div style={{ display: 'grid', gap: 12, alignContent: 'start', alignItems: 'start', alignSelf: 'start' }}>
              {mobileTab === 'urgent' && (
              <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12, alignSelf: 'start' }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>긴급 보고</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {urgentWls
                    .filter((w) => {
                      const d = new Date((w as any).createdAt || w.date).getTime();
                      const threeDays = 3 * 24 * 60 * 60 * 1000;
                      return Date.now() - d <= threeDays;
                    })
                    .sort((a, b) => new Date((b as any).createdAt || b.date).getTime() - new Date((a as any).createdAt || a.date).getTime())
                    .map((w) => {
                      const anyW: any = w as any;
                      const authorId = getWorklogAuthorId(anyW);
                      const authorName = String(anyW.createdBy?.name || w.userName || anyW.userName || '').trim();
                      const attachments = anyW.attachments || {};
                      const firstImg = getWorklogFirstImage(anyW);
                      const contentHtml = String(anyW.contentHtml || attachments.contentHtml || '').trim();
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {viewMode === 'full' ? (
                              <UserAvatar userId={authorId} name={authorName || w.title} size={40} style={{ borderRadius: 8 }} />
                            ) : firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                                  {viewMode === 'summary' ? (
                                    <UserAvatar userId={authorId} name={authorName || w.title} size={22} style={{ marginLeft: 'auto' }} />
                                  ) : null}
                                </div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {fmtDatetime(anyW.createdAt, w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                              </div>
                              <div style={{ color: '#334155', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{snippet}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  {urgentWls.filter((w) => (Date.now() - new Date((w as any).createdAt || w.date).getTime()) <= 3 * 24 * 60 * 60 * 1000).length === 0 && (
                    <div style={{ color: '#94a3b8' }}>최근 3일간 긴급보고 없음</div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn" onClick={() => setUrgentOpen(true)}>더보기</button>
                </div>
              </div>
              )}
              {mobileTab === 'comments' && (
              <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12, alignSelf: 'start' }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 댓글</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {latestComments
                    .filter((c) => (Date.now() - new Date(c.createdAt).getTime()) <= 3 * 24 * 60 * 60 * 1000)
                    .map((c) => (
                      <CommentWithContext key={c.subjectId} c={c} filterTeam={filterTeam} filterName={filterName} viewMode={viewMode} />
                    ))}
                  {latestComments.filter((c) => (Date.now() - new Date(c.createdAt).getTime()) <= 3 * 24 * 60 * 60 * 1000).length === 0 && (
                    <div style={{ color: '#94a3b8' }}>최근 3일간 댓글 없음</div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn" onClick={() => setCommentsOpen(true)}>더보기</button>
                </div>
              </div>
              )}
            </div>
            )}
            {mobileTab === 'worklogs' && (
            <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 업무일지</div>
              {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {pagedWorklogs.map((w) => {
                      const anyW: any = w as any;
                      const authorId = getWorklogAuthorId(anyW);
                      const authorName = String(anyW.createdBy?.name || w.userName || anyW.userName || '').trim();
                      const attachments = anyW.attachments || {};
                      const firstImg = getWorklogFirstImage(anyW);
                      const contentHtml = String(anyW.contentHtml || attachments.contentHtml || '').trim();
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const thumbSize = 40;
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      const planner = (anyW.structuredData && anyW.structuredData.planner) || null;
                      const breadcrumb = String(planner?.breadcrumb || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          {breadcrumb && (
                            <div style={{ fontSize: 11, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 6, padding: '3px 8px', display: 'inline-block', fontWeight: 600, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                              📋 {breadcrumb}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {viewMode === 'full' ? (
                              <UserAvatar userId={authorId} name={authorName || w.title} size={thumbSize} style={{ borderRadius: 8 }} />
                            ) : firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: thumbSize, height: thumbSize, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: thumbSize, height: thumbSize, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ fontWeight: 700 }}>{w.title || '(제목 없음)'}</div>
                                  {viewMode === 'summary' ? (
                                    <UserAvatar userId={authorId} name={authorName || w.title} size={22} style={{ marginLeft: 'auto' }} />
                                  ) : null}
                                </div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {fmtDatetime(anyW.createdAt, w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                              </div>
                              {viewMode==='summary' && (
                                <div style={{ color: '#334155', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{snippet}</div>
                              )}
                            </div>
                          </div>
                          {viewMode === 'full' && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <WorklogDocument worklog={anyW} variant="content" />
                            </div>
                          )}
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginTop: 4, borderTop: '1px solid #e5e7eb', paddingTop: 8, display: 'grid', gap: 8 }}
                          >
                            <LikeButton
                              worklogId={w.id}
                              initial={likeMap[w.id] || { count: 0, liked: false }}
                              onChange={(next) => setLikeMap((m) => ({ ...m, [w.id]: next }))}
                            />
                            <CommentsBox
                              worklogId={w.id}
                              worklogAuthorId={w.userId}
                              worklogAuthorName={w.userName}
                            />
                          </div>
                        </div>
                      );
                    })}
                  {worklogTotal === 0 && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
                  {worklogTotal > WORKLOG_PAGE_SIZE && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <button
                        className="btn"
                        disabled={worklogPage <= 1}
                        onClick={() => setWorklogPage((p) => Math.max(1, p - 1))}
                      >이전</button>
                      <div style={{ fontSize: 13, color: '#475569' }}>
                        {worklogPage} / {totalWorklogPages} 페이지 · 총 {worklogTotal}건
                      </div>
                      <button
                        className="btn"
                        disabled={worklogPage >= totalWorklogPages}
                        onClick={() => setWorklogPage((p) => Math.min(totalWorklogPages, p + 1))}
                      >다음</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </>
        ) : (
          <>
            {/* 데스크탑: 최근 업무일지 왼쪽, 긴급 보고 / 최근 댓글 오른쪽 — 각 컬럼 독립 스크롤 */}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1fr)', height: 'calc(100vh - 160px)', alignItems: 'stretch' }}>
            <div className="always-scroll" style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12, overflowY: 'auto' }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 업무일지</div>
              {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {pagedWorklogs.map((w) => {
                      const anyW: any = w as any;
                      const authorId = getWorklogAuthorId(anyW);
                      const authorName = String(anyW.createdBy?.name || w.userName || anyW.userName || '').trim();
                      const attachments = anyW.attachments || {};
                      const firstImg = getWorklogFirstImage(anyW);
                      const contentHtml = String(anyW.contentHtml || attachments.contentHtml || '').trim();
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const thumbSize = 40;
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      const planner = (anyW.structuredData && anyW.structuredData.planner) || null;
                      const breadcrumb = String(planner?.breadcrumb || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          {breadcrumb && (
                            <div style={{ fontSize: 11, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 6, padding: '3px 8px', display: 'inline-block', fontWeight: 600, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                              📋 {breadcrumb}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {viewMode === 'full' ? (
                              <UserAvatar userId={authorId} name={authorName || w.title} size={thumbSize} style={{ borderRadius: 8 }} />
                            ) : firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: thumbSize, height: thumbSize, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: thumbSize, height: thumbSize, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ fontWeight: 700 }}>{w.title || '(제목 없음)'}</div>
                                  {viewMode === 'summary' ? (
                                    <UserAvatar userId={authorId} name={authorName || w.title} size={22} style={{ marginLeft: 'auto' }} />
                                  ) : null}
                                </div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {fmtDatetime(anyW.createdAt, w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                              </div>
                              {viewMode==='summary' && (
                                <div style={{ color: '#334155', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{snippet}</div>
                              )}
                            </div>
                          </div>
                          {viewMode === 'full' && (
                            <div onClick={(e) => e.stopPropagation()}>
                              <WorklogDocument worklog={anyW} variant="content" />
                            </div>
                          )}
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginTop: 4, borderTop: '1px solid #e5e7eb', paddingTop: 8, display: 'grid', gap: 8 }}
                          >
                            <LikeButton
                              worklogId={w.id}
                              initial={likeMap[w.id] || { count: 0, liked: false }}
                              onChange={(next) => setLikeMap((m) => ({ ...m, [w.id]: next }))}
                            />
                            <CommentsBox
                              worklogId={w.id}
                              worklogAuthorId={w.userId}
                              worklogAuthorName={w.userName}
                            />
                          </div>
                        </div>
                      );
                    })}
                  {worklogTotal === 0 && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
                  {worklogTotal > WORKLOG_PAGE_SIZE && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <button className="btn" disabled={worklogPage <= 1} onClick={() => setWorklogPage((p) => Math.max(1, p - 1))}>이전</button>
                      <div style={{ fontSize: 13, color: '#475569' }}>{worklogPage} / {totalWorklogPages} 페이지 · 총 {worklogTotal}건</div>
                      <button className="btn" disabled={worklogPage >= totalWorklogPages} onClick={() => setWorklogPage((p) => Math.min(totalWorklogPages, p + 1))}>다음</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="always-scroll" style={{ display: 'grid', gap: 12, alignContent: 'start', minWidth: 0, overflowY: 'auto' }}>
              <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12, alignSelf: 'start' }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>긴급 보고</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {urgentWls
                    .filter((w) => { const d = new Date((w as any).createdAt || w.date).getTime(); return Date.now() - d <= 3 * 24 * 60 * 60 * 1000; })
                    .sort((a, b) => new Date((b as any).createdAt || b.date).getTime() - new Date((a as any).createdAt || a.date).getTime())
                    .map((w) => {
                      const anyW: any = w as any;
                      const authorId = getWorklogAuthorId(anyW);
                      const authorName = String(anyW.createdBy?.name || w.userName || anyW.userName || '').trim();
                      const attachments = anyW.attachments || {};
                      const firstImg = getWorklogFirstImage(anyW);
                      const contentHtml = String(anyW.contentHtml || attachments.contentHtml || '').trim();
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {viewMode === 'full' ? (
                              <UserAvatar userId={authorId} name={authorName || w.title} size={40} style={{ borderRadius: 8 }} />
                            ) : firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                                  {viewMode === 'summary' ? (<UserAvatar userId={authorId} name={authorName || w.title} size={22} style={{ marginLeft: 'auto' }} />) : null}
                                </div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {fmtDatetime(anyW.createdAt, w.date)}</div>
                              </div>
                              <div style={{ color: '#334155', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{snippet}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  {urgentWls.filter((w) => (Date.now() - new Date((w as any).createdAt || w.date).getTime()) <= 3 * 24 * 60 * 60 * 1000).length === 0 && (
                    <div style={{ color: '#94a3b8' }}>최근 3일간 긴급보고 없음</div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn" onClick={() => setUrgentOpen(true)}>더보기</button>
                </div>
              </div>
              <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12, alignSelf: 'start' }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 댓글</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {latestComments
                    .filter((c) => (Date.now() - new Date(c.createdAt).getTime()) <= 3 * 24 * 60 * 60 * 1000)
                    .map((c) => (
                      <CommentWithContext key={c.subjectId} c={c} filterTeam={filterTeam} filterName={filterName} viewMode={viewMode} />
                    ))}
                  {latestComments.filter((c) => (Date.now() - new Date(c.createdAt).getTime()) <= 3 * 24 * 60 * 60 * 1000).length === 0 && (
                    <div style={{ color: '#94a3b8' }}>최근 3일간 댓글 없음</div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="btn" onClick={() => setCommentsOpen(true)}>더보기</button>
                </div>
              </div>
            </div>
            </div>
          </>
        )}
      </div>
      
      {commentsOpen && (
        <div className="image-overlay" onClick={() => setCommentsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: 16, borderRadius: 12, maxWidth: 1000, width: '96%', maxHeight: '85vh', overflowY: 'auto', display: 'grid', gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>최근 댓글 전체</div>
            {latestComments.map((c) => (
              <CommentWithContext key={c.subjectId} c={c} filterTeam={filterTeam} filterName={filterName} viewMode={viewMode} />
            ))}
            {latestComments.length === 0 && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn" onClick={() => setCommentsOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {detail && (
        <div className="image-overlay" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: 16, borderRadius: 12, maxWidth: 1200, width: '96%', maxHeight: '90vh', overflowY: 'auto' }}>
            <WorklogDocument worklog={detailFull ?? detail} variant="full" />
            <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <CommentsBox
                worklogId={(detail as any).id}
                worklogAuthorId={(detail as any).userId || (detail as any).createdById}
                worklogAuthorName={(detail as any).userName || (detail as any).createdBy?.name}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setDetail(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {urgentOpen && (
        <div className="image-overlay" onClick={() => setUrgentOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: 16, borderRadius: 12, maxWidth: 1000, width: '96%', maxHeight: '85vh', overflowY: 'auto', display: 'grid', gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>긴급 보고 전체</div>
            {[...urgentWls].sort((a, b) => new Date((b as any).createdAt || b.date).getTime() - new Date((a as any).createdAt || a.date).getTime()).map((w) => {
              const anyW: any = w as any;
              const authorId = getWorklogAuthorId(anyW);
              const authorName = String(anyW.createdBy?.name || w.userName || anyW.userName || '').trim();
              const attachments = anyW.attachments || {};
              const firstImg = getWorklogFirstImage(anyW);
              const contentHtml = String(anyW.contentHtml || attachments.contentHtml || '').trim();
              const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
              const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
              const snippet = (snippetSrc || '').trim();
              return (
                <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {viewMode === 'full' ? (
                      <UserAvatar userId={authorId} name={authorName || w.title} size={40} style={{ borderRadius: 8 }} />
                    ) : firstImg ? (
                      <img src={firstImg} alt="thumb" style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                    )}
                    <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'grid', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                          {viewMode === 'summary' ? (
                            <UserAvatar userId={authorId} name={authorName || w.title} size={22} style={{ marginLeft: 'auto' }} />
                          ) : null}
                        </div>
                        <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {fmtDatetime(anyW.createdAt, w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                      </div>
                      <div style={{ color: '#334155', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{snippet}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            {!urgentWls.length && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <button className="btn" onClick={() => setUrgentOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function absLink(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}

function absolutizeUploads(html: string): string {
  if (!html) return html;
  return html.replace(/(src|href)=["'](\/(api\/)?(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => {
    const path = String(p || '');
    const fixed = path.startsWith('/files/') ? `/api${path}` : path;
    return `${attr}="${apiUrl(fixed)}"`;
  });
}

function stripImgs(html: string): string {
  if (!html) return html;
  return html.replace(/<img\b[^>]*>/gi, '');
}

function htmlToText(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function getWorklogAuthorId(w: any): string {
  return String(w?.createdById || w?.createdBy?.id || w?.userId || '').trim();
}

function getWorklogFirstImage(w: any): string {
  const attachments = w?.attachments || {};
  const files = ([] as any[]).concat(attachments?.files || [], attachments?.photos || [], attachments?.images || [], attachments?.image || []);
  const isImage = (f: any, url: string) => {
    if (f && typeof f === 'object') {
      const t = String(f.type || f.mimeType || f.contentType || '').toLowerCase();
      if (t.startsWith('image/')) return true;
      const n = String(f.name || f.originalName || f.filename || '').toLowerCase();
      if (/(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return true;
    }
    return /(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(url || '').split('?')[0]);
  };
  const pickUrl = (f: any) => {
    if (!f) return '';
    if (typeof f === 'string') return f;
    return String(f.url || f.path || f.src || f.href || f.downloadUrl || f.download_url || '');
  };
  const normalize = (raw: string) => {
    const u = String(raw || '').trim();
    if (!u) return '';
    if (u.startsWith('/files/')) return `/api${u}`;
    if (u.startsWith('files/')) return `/api/${u}`;
    return u;
  };
  const fileImg = files.find((f: any) => {
    const u = normalize(pickUrl(f));
    return !!u && isImage(f, u);
  });
  if (fileImg) {
    const u = normalize(pickUrl(fileImg));
    if (u) return absLink(u);
  }

  const html = String(w?.contentHtml || attachments?.contentHtml || '').trim();
  if (html) {
    const abs = absolutizeUploads(html);
    const m = abs.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1]) return m[1];
  }

  const note = String(w?.note || '').trim();
  if (note) {
    const absNote = absolutizeUploads(note);
    const m1 = absNote.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m1 && m1[1]) return m1[1];

    const m2 = note.match(/!\[[^\]]*\]\(([^)]+)\)/);
    if (m2 && m2[1]) {
      const raw = String(m2[1]).trim();
      const normalized = raw.startsWith('uploads/') ? `/${raw}` : (raw.startsWith('files/') ? `/api/${raw}` : raw);
      return absLink(normalized);
    }

    const m3 = note.match(/(https?:\/\/[^\s)"']+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^\s)"']*)?)/i);
    if (m3 && m3[1]) return m3[1];

    const m4 = note.match(/(\/(?:uploads|files)\/[^\s)"']+\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\?[^\s)"']*)?)/i);
    if (m4 && m4[1]) {
      const p = String(m4[1]);
      const fixed = p.startsWith('/files/') ? `/api${p}` : p;
      return absLink(fixed);
    }
  }

  return '';
}

function CommentWithContext({ c, filterTeam, filterName, viewMode }: { c: FB; filterTeam?: string; filterName?: string; viewMode?: 'summary' | 'full' }) {
  const [wl, setWl] = useState<any | null>(null);
  const [prev, setPrev] = useState<Array<{ id: string; authorId?: string; authorName?: string; authorTeam?: string | null; content: string; createdAt: string }>>([]);
  // The worklog body is always collapsed by default so the comments
  // stand out. Users opt-in via the 펼치기 toggle to read the full
  // 업무일지. (Previously this was open in the "전체 보기" modal but
  // the user wants 접기 to be the universal default.)
  const [bodyOpen, setBodyOpen] = useState<boolean>(false);
  void viewMode;
  useEffect(() => {
    (async () => {
      try {
        const w = await apiJson<any>(`/api/worklogs/${encodeURIComponent(c.subjectId)}`);
        setWl(w);
      } catch {}
      try {
        const fbr = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=Worklog&subjectId=${encodeURIComponent(c.subjectId)}&limit=20`);
        const items = (fbr.items || []).map((x: any) => ({ id: x.id, authorId: x.authorId, authorName: x.authorName, authorTeam: x.authorTeam ?? null, content: x.content, createdAt: x.createdAt }));
        const before = items.filter((x) => x.id !== c.id).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setPrev(before);
      } catch {}
    })();
  }, [c.subjectId, c.id]);
  // The single-record endpoint /api/worklogs/:id returns the row with
  // its `createdBy` relation but does NOT flatten `userName`/`teamName`
  // the way /search does. Resolve both shapes so we never fall back
  // to "익명" / no team when the data is actually present.
  const wlUserName = String(wl?.userName || wl?.createdBy?.name || '').trim();
  const wlTeamName = String(wl?.teamName || wl?.createdBy?.orgUnit?.name || '').trim();
  const matches = (!filterTeam || (wlTeamName.toLowerCase().includes(filterTeam.toLowerCase()))) && (!filterName || (wlUserName.toLowerCase().includes(filterName.toLowerCase())));
  if ((filterTeam || filterName) && !matches) return null;
  const title = (wl?.note || '').split('\n')[0] || '';
  const authorId = getWorklogAuthorId(wl);
  const firstImg = getWorklogFirstImage(wl);
  // Right-hand "최근 댓글" card. Layout:
  //   ┌─────────────────────────────────────────┐
  //   │ [원본 일지 작성자]  팀  일자  조회권한    │  ← who wrote it
  //   │ 일지 제목                                  │
  //   │ ┌───────────────────────────────────────┐ │
  //   │ │ 일지 본문 (max-height + scroll)       │ │  ← scrollable body
  //   │ └───────────────────────────────────────┘ │
  //   │ ─── 댓글 ─────────────────────────────── │
  //   │ [작성자] 댓글내용                          │  ← comments + add input
  //   │ [입력칸]                                   │
  //   └─────────────────────────────────────────┘
  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', fontSize: 12 }}>
      {/* 원본 일지 작성자 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {authorId ? (
          <UserAvatar userId={authorId} name={wlUserName || title || '익명'} size={28} style={{ borderRadius: 6, flex: '0 0 auto' }} />
        ) : firstImg ? (
          <img src={firstImg} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }} />
        ) : (
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#f1f5f9', flex: '0 0 auto' }} />
        )}
        <div style={{ display: 'grid', gap: 1, flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: 13 }}>{wlUserName || '익명'}</span>
            {wlTeamName ? <span style={{ color: '#64748b', fontSize: 11 }}>{wlTeamName}</span> : null}
            <span style={{ color: '#94a3b8', fontSize: 11 }}>· {formatKstDatetime(wl?.createdAt || wl?.date || c.createdAt)}</span>
            {(wl as any)?.visibility ? <span style={{ color: '#94a3b8', fontSize: 11 }}>· {visibilityKo((wl as any).visibility)}</span> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              {title || '(제목 없음)'}
            </div>
            {/* Toggle to expand/collapse the worklog body. We surface
                this on the title row so the right rail emphasises the
                comments below; users opt-in to read the full 일지. */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setBodyOpen((v) => !v); }}
              style={{
                flex: '0 0 auto',
                padding: '2px 8px',
                fontSize: 11,
                lineHeight: 1.4,
                border: '1px solid #CBD5E1',
                borderRadius: 999,
                background: bodyOpen ? '#E0F2FE' : '#fff',
                color: '#475569',
                cursor: 'pointer',
              }}
              aria-expanded={bodyOpen}
              title={bodyOpen ? '내용 접기' : '내용 펼치기'}
            >
              {bodyOpen ? '접기 ▴' : '펼치기 ▾'}
            </button>
          </div>
        </div>
      </div>

      {/* 일지 본문 — 펼치기 토글로만 보여서 댓글이 부각되게 한다. */}
      {bodyOpen && (
        wl ? (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              background: '#fafaf7',
              padding: 8,
              maxHeight: 220,
              overflowY: 'auto',
              fontSize: 12,
              lineHeight: 1.55,
            }}
          >
            <WorklogDocument worklog={wl} variant="content" />
          </div>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 11, padding: '8px 4px' }}>일지 내용을 불러오는 중…</div>
        )
      )}

      {/* 댓글 영역 — 작성자/내용 + 새 댓글 입력 */}
      <div onClick={(e) => e.stopPropagation()} style={{ borderTop: '1px solid #e5e7eb', paddingTop: 8, fontSize: 12 }}>
        <CommentsBox
          worklogId={c.subjectId}
          worklogAuthorId={getWorklogAuthorId(wl)}
          worklogAuthorName={wlUserName}
        />
      </div>
    </div>
  );
}

type CommentItem = {
  id: string;
  authorId?: string;
  authorName?: string;
  authorTeam?: string | null;
  content: string;
  createdAt: string;
  type?: 'GENERAL' | 'RUBRIC' | 'INSTRUCTION';
  instruction?: {
    id: string;
    assigneeId: string;
    assigneeName: string;
    dueDate: string | null;
    status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
    completedWorklogId?: string | null;
  } | null;
};

function CommentsBox({
  worklogId,
  worklogAuthorId,
  worklogAuthorName,
}: {
  worklogId: string;
  worklogAuthorId?: string;
  worklogAuthorName?: string;
}) {
  const [items, setItems] = useState<CommentItem[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Instruction-mode state
  const [mode, setMode] = useState<'GENERAL' | 'INSTRUCTION'>('GENERAL');
  const defaultDue = useMemo(() => {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }, []);
  const [assigneeId, setAssigneeId] = useState<string>(worklogAuthorId || '');
  const [dueDate, setDueDate] = useState<string>(defaultDue);
  const [users, setUsers] = useState<Array<{ id: string; name: string; orgName?: string }>>([]);
  // Lazily fetch the active user list the first time the user enables INSTRUCTION mode.
  useEffect(() => {
    if (mode !== 'INSTRUCTION' || users.length > 0) return;
    (async () => {
      try {
        const r = await apiJson<{ items: any[] }>('/api/users');
        setUsers((r.items || []).map((u: any) => ({ id: u.id, name: u.name, orgName: u.orgName })));
      } catch {}
    })();
  }, [mode, users.length]);
  useEffect(() => {
    if (worklogAuthorId && !assigneeId) setAssigneeId(worklogAuthorId);
  }, [worklogAuthorId, assigneeId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=${encodeURIComponent('Worklog')}&subjectId=${encodeURIComponent(worklogId)}&limit=100`);
      // Sort ascending by createdAt so the newest comment appears at
      // the bottom — matches conventional chat/threaded comment UX.
      const mapped = (r.items || []).map((x: any) => ({
        id: x.id,
        authorId: x.authorId,
        authorName: x.authorName,
        authorTeam: x.authorTeam ?? null,
        content: x.content,
        createdAt: x.createdAt,
        type: x.type,
        instruction: x.instruction,
      }));
      mapped.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      setItems(mapped);
    } catch (e) {
      setError('댓글 조회 실패');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [worklogId]);
  async function onSubmit() {
    if (!text.trim()) return;
    const uid = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
    if (!uid) { alert('로그인이 필요합니다'); return; }
    setSubmitting(true);
    try {
      const body: any = {
        subjectType: 'Worklog',
        subjectId: worklogId,
        authorId: uid,
        type: mode,
        content: text.trim(),
      };
      if (mode === 'INSTRUCTION') {
        body.instructionAssigneeId = assigneeId || worklogAuthorId || '';
        body.instructionTitle = text.trim().split('\n')[0];
        if (dueDate) body.instructionDueDate = new Date(dueDate + 'T00:00:00').toISOString();
      }
      await apiJson(`/api/feedbacks`, { method: 'POST', body: JSON.stringify(body) });
      setText('');
      // Reset back to General after sending instruction
      if (mode === 'INSTRUCTION') {
        setMode('GENERAL');
        setDueDate(defaultDue);
      }
      await load();
    } catch (e) {
      alert(mode === 'INSTRUCTION' ? '업무 지시 등록 실패' : '댓글 등록 실패');
    } finally {
      setSubmitting(false);
    }
  }
  function statusKo(s: string): string {
    switch (s) {
      case 'OPEN': return '대기';
      case 'IN_PROGRESS': return '진행중';
      case 'DONE': return '완료';
      case 'CANCELLED': return '취소';
      default: return s;
    }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 700 }}>댓글</div>
      {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
        items.length ? (
          <div style={{ display: 'grid', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
            {items.map((c) => {
              const isIns = c.type === 'INSTRUCTION';
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'grid',
                    gap: 4,
                    border: isIns ? '1px solid #fecaca' : '1px solid transparent',
                    background: isIns ? '#fff1f2' : 'transparent',
                    borderRadius: isIns ? 8 : 0,
                    padding: isIns ? 8 : 0,
                  }}
                >
                  <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {isIns && (
                      <span style={{ background: '#dc2626', color: '#fff', borderRadius: 6, padding: '1px 6px', fontWeight: 700 }}>📌 업무 지시</span>
                    )}
                    <UserAvatar userId={String(c.authorId || '')} name={String(c.authorName || '익명')} size={14} />
                    <span style={{ fontWeight: 700 }}>{c.authorName || '익명'}</span>
                    {c.authorTeam ? <span style={{ color: '#64748b' }}>· {c.authorTeam}</span> : null}
                    <span style={{ color: '#94a3b8' }}>· {formatKstDatetime(c.createdAt)}</span>
                    {isIns && c.instruction && (
                      <span style={{ marginLeft: 6, color: '#7c2d12' }}>
                        → {c.instruction.assigneeName || '담당자'}
                        {c.instruction.dueDate ? ` · 마감 ${formatKstYmd(c.instruction.dueDate)}` : ''}
                        {' · '}
                        <strong>{statusKo(c.instruction.status)}</strong>
                      </span>
                    )}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{c.content}</div>
                </div>
              );
            })}
          </div>
        ) : <div style={{ color: '#94a3b8' }}>등록된 댓글이 없습니다.</div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 0, border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
          <button
            type="button"
            className={mode === 'GENERAL' ? 'btn btn-primary' : 'btn'}
            onClick={() => setMode('GENERAL')}
            style={{ height: 30, padding: '0 10px', borderRadius: 0, border: 'none' }}
          >댓글</button>
          <button
            type="button"
            className={mode === 'INSTRUCTION' ? 'btn btn-primary' : 'btn'}
            onClick={() => setMode('INSTRUCTION')}
            style={{ height: 30, padding: '0 10px', borderRadius: 0, border: 'none' }}
          >📌 업무 지시</button>
        </div>
        {mode === 'INSTRUCTION' && (
          <>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              style={{ height: 30, border: '1px solid #CBD5E1', borderRadius: 8, padding: '0 6px' }}
            >
              {worklogAuthorId && (
                <option value={worklogAuthorId}>{worklogAuthorName || '작성자'} (기본)</option>
              )}
              {users
                .filter((u) => u.id !== worklogAuthorId)
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.orgName ? ` · ${u.orgName}` : ''}</option>
                ))}
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              style={{ height: 30, border: '1px solid #CBD5E1', borderRadius: 8, padding: '0 6px' }}
            />
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === 'INSTRUCTION' ? '업무 지시 내용...' : '댓글 입력...'}
          style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }}
        />
        <button className="btn btn-primary" disabled={submitting || !text.trim()} onClick={onSubmit}>
          {submitting ? '등록중…' : mode === 'INSTRUCTION' ? '지시 등록' : '등록'}
        </button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  );
}

/**
 * Inline like (heart) button. Optimistically toggles, syncs with server,
 * and pops a modal listing every user who liked when the count is clicked.
 */
function LikeButton({
  worklogId,
  initial,
  onChange,
}: {
  worklogId: string;
  initial?: { count: number; liked: boolean };
  onChange?: (next: { count: number; liked: boolean }) => void;
}) {
  const [count, setCount] = useState<number>(initial?.count ?? 0);
  const [liked, setLiked] = useState<boolean>(initial?.liked ?? false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [likers, setLikers] = useState<Array<{ userId: string; name: string; createdAt: string }>>([]);
  const [likersLoading, setLikersLoading] = useState(false);

  useEffect(() => {
    if (initial) {
      setCount(initial.count);
      setLiked(initial.liked);
    }
  }, [initial?.count, initial?.liked]);

  async function toggle() {
    if (busy) return;
    const uid = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
    if (!uid) {
      alert('로그인이 필요합니다');
      return;
    }
    setBusy(true);
    // Optimistic update
    const prev = { count, liked };
    const nextLiked = !liked;
    const nextCount = Math.max(0, count + (nextLiked ? 1 : -1));
    setLiked(nextLiked);
    setCount(nextCount);
    try {
      const r = await apiJson<{ liked: boolean; count: number }>('/api/likes/toggle', {
        method: 'POST',
        body: JSON.stringify({ subjectType: 'Worklog', subjectId: worklogId, userId: uid }),
      });
      setLiked(r.liked);
      setCount(r.count);
      onChange?.({ count: r.count, liked: r.liked });
    } catch {
      // Revert on failure
      setLiked(prev.liked);
      setCount(prev.count);
      alert('좋아요 처리 실패');
    } finally {
      setBusy(false);
    }
  }

  async function openLikers() {
    if (count === 0) return;
    setOpen(true);
    setLikersLoading(true);
    try {
      const r = await apiJson<{ likers: Array<{ userId: string; name: string; createdAt: string }> }>(
        `/api/likes?subjectType=Worklog&subjectId=${encodeURIComponent(worklogId)}`,
      );
      setLikers(r.likers || []);
    } catch {
      setLikers([]);
    } finally {
      setLikersLoading(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={liked}
          title={liked ? '좋아요 취소' : '좋아요'}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            border: '1px solid #e5e7eb',
            borderRadius: 999,
            background: liked ? '#fee2e2' : '#fff',
            color: liked ? '#dc2626' : '#334155',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          <span style={{ fontSize: 14 }}>{liked ? '♥' : '♡'}</span>
          <span>좋아요</span>
        </button>
        <button
          type="button"
          onClick={openLikers}
          disabled={count === 0}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#475569',
            cursor: count === 0 ? 'default' : 'pointer',
            fontSize: 13,
            padding: 0,
          }}
        >
          {count}명
        </button>
      </div>
      {open && (
        <div
          className="image-overlay"
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', padding: 16, borderRadius: 12, maxWidth: 360, width: '92%', maxHeight: '70vh', overflowY: 'auto' }}
          >
            <div style={{ fontWeight: 800, marginBottom: 8 }}>좋아요 ({count})</div>
            {likersLoading ? (
              <div style={{ color: '#64748b' }}>불러오는 중…</div>
            ) : likers.length === 0 ? (
              <div style={{ color: '#94a3b8' }}>아직 좋아요가 없습니다.</div>
            ) : (
              <div style={{ display: 'grid', gap: 6 }}>
                {likers.map((u) => (
                  <div key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserAvatar userId={u.userId} name={u.name} size={20} />
                    <div style={{ fontWeight: 600 }}>{u.name || '이름없음'}</div>
                    <div style={{ marginLeft: 'auto', fontSize: 12, color: '#94a3b8' }}>{formatKstYmd(u.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn" onClick={() => setOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
