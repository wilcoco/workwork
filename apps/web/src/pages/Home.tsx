import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson, apiUrl } from '../lib/api';
import { formatKstDatetime, formatKstYmd } from '../lib/time';
import { WorklogDocument } from '../components/WorklogDocument';
import { UserAvatar } from '../components/UserAvatar';

type WL = { id: string; userId?: string; title: string; excerpt: string; userName?: string; teamName?: string; date: string; createdAt?: string; visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY' };
type FB = { id: string; subjectId: string; authorId?: string; authorName?: string; content: string; createdAt: string };

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

export function Home() {
  const nav = useNavigate();
  const [worklogs, setWorklogs] = useState<WL[]>([]);
  const [urgentWls, setUrgentWls] = useState<WL[]>([]);
  const [comments, setComments] = useState<FB[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overdue, setOverdue] = useState<any | null>(null);
  const [overdueError, setOverdueError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [filterTeam, setFilterTeam] = useState('');
  const [filterName, setFilterName] = useState('');
  const [viewMode, setViewMode] = useState<'summary'|'full'>('full');
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTab, setMobileTab] = useState<'urgent' | 'worklogs' | 'comments'>('urgent');
  const [worklogDays, setWorklogDays] = useState(3);
  const WORKLOG_DAYS_STEP = 3;
  const teamOptions = useMemo(() => {
    const s = new Set<string>();
    worklogs.forEach(w => { if (w.teamName) s.add(w.teamName); });
    return Array.from(s).sort();
  }, [worklogs]);
  const nameOptions = useMemo(() => {
    const s = new Set<string>();
    worklogs.forEach(w => { if (w.userName) s.add(w.userName); });
    return Array.from(s).sort();
  }, [worklogs]);
  const latestComments = useMemo(() => {
    const map = new Map<string, { c: FB; t: number }>();
    comments.forEach(c => {
      const t = new Date(c.createdAt).getTime();
      const cur = map.get(c.subjectId);
      if (!cur || t > cur.t) map.set(c.subjectId, { c, t });
    });
    return Array.from(map.values()).sort((a,b) => b.t - a.t).map(x => x.c);
  }, [comments]);

  const filteredWorklogs = useMemo(() => {
    const windowMs = worklogDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const ts = (w: any) => new Date(w?.createdAt || w?.date).getTime();
    return (worklogs || [])
      .filter((w) => !filterTeam || (w.teamName || '').toLowerCase().includes(filterTeam.toLowerCase()))
      .filter((w) => !filterName || (w.userName || '').toLowerCase().includes(filterName.toLowerCase()))
      .filter((w) => (now - ts(w)) <= windowMs)
      .slice()
      .sort((a, b) => ts(b) - ts(a));
  }, [filterName, filterTeam, worklogDays, worklogs]);

  const canShowMoreWorklogs = useMemo(() => {
    const windowMs = worklogDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const ts = (w: any) => new Date(w?.createdAt || w?.date).getTime();
    return (worklogs || [])
      .filter((w) => !filterTeam || (w.teamName || '').toLowerCase().includes(filterTeam.toLowerCase()))
      .filter((w) => !filterName || (w.userName || '').toLowerCase().includes(filterName.toLowerCase()))
      .some((w) => (now - ts(w)) > windowMs);
  }, [filterName, filterTeam, worklogDays, worklogs]);

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

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
        const wlQs = viewerId ? `limit=200&viewerId=${encodeURIComponent(viewerId)}` : 'limit=200';
        const wl = await apiJson<{ items: WL[] }>(`/api/worklogs/search?${wlQs}`);
        setWorklogs(wl.items || []);
        try {
          const uwQs = viewerId ? `limit=20&urgent=true&viewerId=${encodeURIComponent(viewerId)}` : 'limit=20&urgent=true';
          const uw = await apiJson<{ items: WL[] }>(`/api/worklogs/search?${uwQs}`);
          setUrgentWls(uw.items || []);
        } catch {}
      } catch (e: any) {
        setError('업무일지 로드 실패');
      } finally {
        setLoading(false);
      }

    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const viewerId = typeof localStorage !== 'undefined' ? localStorage.getItem('userId') || '' : '';
        if (!viewerId) return;
        setOverdueError(null);
        const r = await apiJson<any>(`/api/users/overdue?userId=${encodeURIComponent(viewerId)}`);
        setOverdue(r || null);
      } catch (e: any) {
        setOverdue(null);
        setOverdueError(e?.message || '오버듀 로드 실패');
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const fb = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=Worklog&limit=60`);
        setComments((fb.items || []).map((x: any) => ({ id: x.id, subjectId: x.subjectId, authorId: x.authorId, authorName: x.authorName, content: x.content, createdAt: x.createdAt })));
      } catch {
        // ignore
      }
    })();
  }, []);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
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
      {overdueError && <div style={{ color: 'red' }}>{overdueError}</div>}
      {(() => {
        const total = Number(overdue?.counts?.total || 0);
        const items = Array.isArray(overdue?.items) ? overdue.items : [];
        const kindKey = (it: any) => String(it?.kind || '').toUpperCase();
        const procCount = Number(overdue?.counts?.processInstances || 0) + Number(overdue?.counts?.processTasks || 0);
        const approvalCount = Number(overdue?.counts?.approvals || 0);
        const helpCount = Number(overdue?.counts?.helpTickets || 0);
        const delegationCount = Number(overdue?.counts?.delegations || 0);
        const initiativeCount = Number(overdue?.counts?.initiatives || 0);
        const preview = (() => {
          const byKind = new Map<string, any[]>();
          for (const it of items) {
            const k = kindKey(it);
            const arr = byKind.get(k) || [];
            arr.push(it);
            byKind.set(k, arr);
          }
          const preferred = ['PROCESS_TASK', 'PROCESS_INSTANCE', 'HELP_TICKET', 'APPROVAL', 'DELEGATION', 'INITIATIVE'];
          const seen = new Set<string>();
          const out: any[] = [];
          for (const k of preferred) {
            const arr = byKind.get(k) || [];
            if (!arr.length) continue;
            const it = arr[0];
            const key = `${kindKey(it)}-${String(it?.id || '')}`;
            if (seen.has(key)) continue;
            out.push(it);
            seen.add(key);
            if (out.length >= 5) return out;
          }
          for (const it of items) {
            const key = `${kindKey(it)}-${String(it?.id || '')}`;
            if (seen.has(key)) continue;
            out.push(it);
            seen.add(key);
            if (out.length >= 5) break;
          }
          return out;
        })();
        const label = (k: any) => {
          const key = String(k || '').toUpperCase();
          if (key === 'PROCESS_TASK') return '프로세스';
          if (key === 'PROCESS_INSTANCE') return '프로세스';
          if (key === 'APPROVAL') return '결재';
          if (key === 'HELP_TICKET') return '업무요청';
          if (key === 'DELEGATION') return '위임';
          if (key === 'INITIATIVE') return '과제';
          return key || '기타';
        };
        if (!overdue) return null;
        return (
          <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 900, color: '#0f172a' }}>마감 초과</div>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: total ? '#b91c1c' : '#64748b', fontWeight: 800 }}>
                {total ? `총 ${total}건` : '없음'}
              </div>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#64748b', fontWeight: 700 }}>
              {procCount ? `프로세스 ${procCount} · ` : ''}
              {helpCount ? `업무요청 ${helpCount} · ` : ''}
              {approvalCount ? `결재 ${approvalCount} · ` : ''}
              {delegationCount ? `위임 ${delegationCount} · ` : ''}
              {initiativeCount ? `과제 ${initiativeCount}` : ''}
            </div>
            {total ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                {preview.map((it: any) => {
                  const key = `${String(it?.kind || '')}-${String(it?.id || '')}`;
                  const due = it?.dueAt ? formatKstYmd(it.dueAt) : '';
                  const href = String(it?.link || '').trim();
                  const title = String(it?.title || '').trim() || '(제목 없음)';
                  return (
                    <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#991b1b', minWidth: 64 }}>{label(it?.kind)}</div>
                      {href ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: 0, height: 'auto', lineHeight: 1.2, fontSize: 13, color: '#0f172a', textDecoration: 'underline', textAlign: 'left' as any }}
                          onClick={() => nav(href)}
                        >
                          {title}
                        </button>
                      ) : (
                        <div style={{ fontSize: 13, color: '#0f172a' }}>{title}</div>
                      )}
                      <div style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{due}</div>
                    </div>
                  );
                })}
                {total > 5 ? (
                  <div style={{ fontSize: 12, color: '#64748b' }}>외 {total - 5}건</div>
                ) : null}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>마감 초과 항목 없음</div>
            )}
          </div>
        );
      })()}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.8fr) minmax(0, 1fr)', alignItems: 'start' }}>
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
                      const contentHtml = anyW.contentHtml || attachments.contentHtml || '';
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {viewMode === 'full' ? (
                              <UserAvatar userId={authorId} name={authorName || w.title} size={84} style={{ borderRadius: 8 }} />
                            ) : firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: 84, height: 84, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: 84, height: 84, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                                  {viewMode === 'summary' ? (
                                    <UserAvatar userId={authorId} name={authorName || w.title} size={22} style={{ marginLeft: 'auto' }} />
                                  ) : null}
                                </div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
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
                  {filteredWorklogs.map((w) => {
                      const anyW: any = w as any;
                      const authorId = getWorklogAuthorId(anyW);
                      const authorName = String(anyW.createdBy?.name || w.userName || anyW.userName || '').trim();
                      const attachments = anyW.attachments || {};
                      const firstImg = getWorklogFirstImage(anyW);
                      const contentHtml = anyW.contentHtml || attachments.contentHtml || '';
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const thumbSize = viewMode==='summary' ? 120 : 84;
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
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
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
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
                        </div>
                      );
                    })}
                  {filteredWorklogs.length === 0 && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
                  {canShowMoreWorklogs && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                      <button className="btn" onClick={() => setWorklogDays((d) => d + WORKLOG_DAYS_STEP)}>더보기</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
          </>
        ) : (
          <>
            {/* 데스크탑: 최근 업무일지 왼쪽, 긴급 보고 / 최근 댓글 오른쪽 */}
            <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 업무일지</div>
              {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {filteredWorklogs.map((w) => {
                      const anyW: any = w as any;
                      const authorId = getWorklogAuthorId(anyW);
                      const authorName = String(anyW.createdBy?.name || w.userName || anyW.userName || '').trim();
                      const attachments = anyW.attachments || {};
                      const firstImg = getWorklogFirstImage(anyW);
                      const contentHtml = anyW.contentHtml || attachments.contentHtml || '';
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const thumbSize = viewMode==='summary' ? 120 : 84;
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
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
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
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
                        </div>
                      );
                    })}
                  {filteredWorklogs.length === 0 && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
                  {canShowMoreWorklogs && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                      <button className="btn" onClick={() => setWorklogDays((d) => d + WORKLOG_DAYS_STEP)}>더보기</button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gap: 12, alignContent: 'start', alignItems: 'start', alignSelf: 'start', minWidth: 0 }}>
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
                      const contentHtml = anyW.contentHtml || attachments.contentHtml || '';
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {viewMode === 'full' ? (
                              <UserAvatar userId={authorId} name={authorName || w.title} size={84} style={{ borderRadius: 8 }} />
                            ) : firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: 84, height: 84, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: 84, height: 84, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                                  {viewMode === 'summary' ? (
                                    <UserAvatar userId={authorId} name={authorName || w.title} size={22} style={{ marginLeft: 'auto' }} />
                                  ) : null}
                                </div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
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
            <WorklogDocument worklog={detail} variant="full" />
            <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <CommentsBox worklogId={(detail as any).id} />
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
              const contentHtml = anyW.contentHtml || attachments.contentHtml || '';
              const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
              const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
              const snippet = (snippetSrc || '').trim();
              return (
                <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {viewMode === 'full' ? (
                      <UserAvatar userId={authorId} name={authorName || w.title} size={84} style={{ borderRadius: 8 }} />
                    ) : firstImg ? (
                      <img src={firstImg} alt="thumb" style={{ width: 84, height: 84, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                    ) : (
                      <div style={{ width: 84, height: 84, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                    )}
                    <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'grid', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                          {viewMode === 'summary' ? (
                            <UserAvatar userId={authorId} name={authorName || w.title} size={22} style={{ marginLeft: 'auto' }} />
                          ) : null}
                        </div>
                        <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
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
  return html.replace(/(src|href)=["'](\/(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => {
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
  const [prev, setPrev] = useState<Array<{ id: string; authorId?: string; authorName?: string; content: string; createdAt: string }>>([]);
  useEffect(() => {
    (async () => {
      try {
        const w = await apiJson<any>(`/api/worklogs/${encodeURIComponent(c.subjectId)}`);
        setWl(w);
      } catch {}
      try {
        const fbr = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=Worklog&subjectId=${encodeURIComponent(c.subjectId)}&limit=20`);
        const items = (fbr.items || []).map((x: any) => ({ id: x.id, authorId: x.authorId, authorName: x.authorName, content: x.content, createdAt: x.createdAt }));
        const before = items.filter((x) => x.id !== c.id).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setPrev(before);
      } catch {}
    })();
  }, [c.subjectId, c.id]);
  const matches = (!filterTeam || ((wl?.teamName || '').toLowerCase().includes(filterTeam.toLowerCase()))) && (!filterName || ((wl?.userName || '').toLowerCase().includes(filterName.toLowerCase())));
  if ((filterTeam || filterName) && !matches) return null;
  const title = (wl?.note || '').split('\n')[0] || '';
  const attachments = wl?.attachments || {};
  const authorId = getWorklogAuthorId(wl);
  const firstImg = getWorklogFirstImage(wl);
  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {firstImg ? (
          <img src={firstImg} alt="thumb" style={{ width: 84, height: 84, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
        ) : (
          <div style={{ width: 84, height: 84, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
        )}
        <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ fontWeight: 700 }}>{title || '(제목 없음)'}</div>
            <div style={{ fontSize: 12, color: '#475569', fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>· {(wl?.userName || '')}</span>
              {authorId ? <UserAvatar userId={authorId} name={String(wl?.userName || title || '')} size={14} /> : null}
              {wl?.teamName ? <span>· {wl.teamName}</span> : null}
              <span>· {formatKstYmd(c.createdAt)}</span>
              {(wl as any)?.visibility ? <span>· 조회권한 {visibilityKo((wl as any).visibility)}</span> : null}
            </div>
          </div>
        </div>
      </div>
      {viewMode === 'full' && wl && (
        <WorklogDocument worklog={wl} variant="content" />
      )}
      <div style={{ display: 'grid', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
        {prev.map((p) => (
          <div key={p.id}>
            <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{p.authorName || '익명'}</span>
              <UserAvatar userId={String(p.authorId || '')} name={String(p.authorName || '익명')} size={14} />
              <span>· {formatKstYmd(p.createdAt)}</span>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{p.content}</div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{c.authorName || '익명'}</span>
            <UserAvatar userId={String(c.authorId || '')} name={String(c.authorName || '익명')} size={14} />
            <span>· {formatKstYmd(c.createdAt)}</span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{c.content}</div>
        </div>
      </div>
    </div>
  );
}

function CommentsBox({ worklogId }: { worklogId: string }) {
  const [items, setItems] = useState<Array<{ id: string; authorId?: string; authorName?: string; content: string; createdAt: string }>>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=${encodeURIComponent('Worklog')}&subjectId=${encodeURIComponent(worklogId)}&limit=100`);
      setItems((r.items || []).map((x: any) => ({ id: x.id, authorId: x.authorId, authorName: x.authorName, content: x.content, createdAt: x.createdAt })));
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
      await apiJson(`/api/feedbacks`, {
        method: 'POST',
        body: JSON.stringify({ subjectType: 'Worklog', subjectId: worklogId, authorId: uid, type: 'GENERAL', content: text.trim() }),
      });
      setText('');
      await load();
    } catch (e) {
      alert('댓글 등록 실패');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontWeight: 700 }}>댓글</div>
      {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
        items.length ? (
          <div style={{ display: 'grid', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
            {items.map((c) => (
              <div key={c.id} style={{ display: 'grid', gap: 2 }}>
                <div style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{c.authorName || '익명'}</span>
                  <UserAvatar userId={String(c.authorId || '')} name={String(c.authorName || '익명')} size={14} />
                  <span>· {formatKstYmd(c.createdAt)}</span>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{c.content}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ color: '#94a3b8' }}>등록된 댓글이 없습니다.</div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="댓글 입력..."
          style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 8, padding: '8px 10px' }}
        />
        <button className="btn btn-primary" disabled={submitting || !text.trim()} onClick={onSubmit}>{submitting ? '등록중…' : '등록'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  );
}
