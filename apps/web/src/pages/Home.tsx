import { useEffect, useMemo, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { formatKstDatetime, formatKstYmd } from '../lib/time';
import { WorklogDocument } from '../components/WorklogDocument';

type WL = { id: string; title: string; excerpt: string; userName?: string; teamName?: string; date: string; createdAt?: string; visibility?: 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY' };
type FB = { id: string; subjectId: string; authorName?: string; content: string; createdAt: string };

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
  const [worklogs, setWorklogs] = useState<WL[]>([]);
  const [urgentWls, setUrgentWls] = useState<WL[]>([]);
  const [comments, setComments] = useState<FB[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [urgentOpen, setUrgentOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [filterTeam, setFilterTeam] = useState('');
  const [filterName, setFilterName] = useState('');
  const [viewMode, setViewMode] = useState<'summary'|'full'>('summary');
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
        const fb = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=Worklog&limit=60`);
        setComments((fb.items || []).map((x: any) => ({ id: x.id, subjectId: x.subjectId, authorName: x.authorName, content: x.content, createdAt: x.createdAt })));
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
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: isMobile ? '1fr' : '1.8fr 1fr', alignItems: 'start' }}>
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
                      const attachments = anyW.attachments || {};
                      const files = attachments.files || [];
                      const firstImg = (() => {
                        const fileImg = files.find((f: any) => /(png|jpe?g|gif|webp|bmp|svg)$/i.test((f.url || f.name || '')));
                        if (fileImg) return absLink(fileImg.url as string);
                        const html = attachments.contentHtml || '';
                        if (html) {
                          const abs = absolutizeUploads(html);
                          const m = abs.match(/<img[^>]+src=["']([^"']+)["']/i);
                          if (m && m[1]) return m[1];
                        }
                        return '';
                      })();
                      const contentHtml = attachments.contentHtml || '';
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: 84, height: 84, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: 84, height: 84, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                              </div>
                              <div style={{ color: '#334155' }}>{snippet}</div>
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
                      const attachments = anyW.attachments || {};
                      const files = attachments.files || [];
                      const firstImg = (() => {
                        const fileImg = files.find((f: any) => /(png|jpe?g|gif|webp|bmp|svg)$/i.test((f.url || f.name || '')));
                        if (fileImg) return absLink(fileImg.url as string);
                        const html = attachments.contentHtml || '';
                        if (html) {
                          const abs = absolutizeUploads(html);
                          const m = abs.match(/<img[^>]+src=["']([^"']+)["']/i);
                          if (m && m[1]) return m[1];
                        }
                        return '';
                      })();
                      const contentHtml = attachments.contentHtml || '';
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const thumbSize = viewMode==='summary' ? 120 : 84;
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: thumbSize, height: thumbSize, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: thumbSize, height: thumbSize, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ fontWeight: 700 }}>{w.title || '(제목 없음)'}</div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                              </div>
                              {viewMode==='summary' && (
                                <div style={{ color: '#334155' }}>{snippet}</div>
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
                      const attachments = anyW.attachments || {};
                      const files = attachments.files || [];
                      const firstImg = (() => {
                        const fileImg = files.find((f: any) => /(png|jpe?g|gif|webp|bmp|svg)$/i.test((f.url || f.name || '')));
                        if (fileImg) return absLink(fileImg.url as string);
                        const html = attachments.contentHtml || '';
                        if (html) {
                          const abs = absolutizeUploads(html);
                          const m = abs.match(/<img[^>]+src=["']([^"']+)["']/i);
                          if (m && m[1]) return m[1];
                        }
                        return '';
                      })();
                      const contentHtml = attachments.contentHtml || '';
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const thumbSize = viewMode==='summary' ? 120 : 84;
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: thumbSize, height: thumbSize, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: thumbSize, height: thumbSize, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ fontWeight: 700 }}>{w.title || '(제목 없음)'}</div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                              </div>
                              {viewMode==='summary' && (
                                <div style={{ color: '#334155' }}>{snippet}</div>
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
            <div style={{ display: 'grid', gap: 12, alignContent: 'start', alignItems: 'start', alignSelf: 'start' }}>
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
                      const attachments = anyW.attachments || {};
                      const files = attachments.files || [];
                      const firstImg = (() => {
                        const fileImg = files.find((f: any) => /(png|jpe?g|gif|webp|bmp|svg)$/i.test((f.url || f.name || '')));
                        if (fileImg) return absLink(fileImg.url as string);
                        const html = attachments.contentHtml || '';
                        if (html) {
                          const abs = absolutizeUploads(html);
                          const m = abs.match(/<img[^>]+src=["']([^"']+)["']/i);
                          if (m && m[1]) return m[1];
                        }
                        return '';
                      })();
                      const contentHtml = attachments.contentHtml || '';
                      const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
                      const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
                      const snippet = (snippetSrc || '').trim();
                      return (
                        <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {firstImg ? (
                              <img src={firstImg} alt="thumb" style={{ width: 84, height: 84, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                            ) : (
                              <div style={{ width: 84, height: 84, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                            )}
                            <div style={{ display: 'grid', gap: 4, flex: 1 }}>
                              <div style={{ display: 'grid', gap: 2 }}>
                                <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                                <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                              </div>
                              <div style={{ color: '#334155' }}>{snippet}</div>
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
              const attachments = anyW.attachments || {};
              const files = attachments.files || [];
              const firstImg = (() => {
                const fileImg = files.find((f: any) => /(png|jpe?g|gif|webp|bmp|svg)$/i.test((f.url || f.name || '')));
                if (fileImg) return absLink(fileImg.url as string);
                const html = attachments.contentHtml || '';
                if (html) {
                  const abs = absolutizeUploads(html);
                  const m = abs.match(/<img[^>]+src=["']([^"']+)["']/i);
                  if (m && m[1]) return m[1];
                }
                return '';
              })();
              const contentHtml = attachments.contentHtml || '';
              const contentText = (anyW.note || '').split('\n').slice(1).join('\n');
              const snippetSrc = contentHtml ? htmlToText(stripImgs(contentHtml)) : contentText;
              const snippet = (snippetSrc || '').trim();
              return (
                <div key={w.id} style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF', cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {firstImg ? (
                      <img src={firstImg} alt="thumb" style={{ width: 84, height: 84, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
                    ) : (
                      <div style={{ width: 84, height: 84, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
                    )}
                    <div style={{ display: 'grid', gap: 4, flex: 1 }}>
                      <div style={{ display: 'grid', gap: 2 }}>
                        <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                        <div style={{ fontSize: 12, color: '#475569', fontWeight: 800 }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstYmd(anyW.createdAt || w.date)} · 조회권한 {visibilityKo(anyW.visibility || (w as any).visibility)}</div>
                      </div>
                      <div style={{ color: '#334155' }}>{snippet}</div>
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
  return html.replace(/(src|href)=["'](\/(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => `${attr}="${apiUrl(p)}"`);
}

function stripImgs(html: string): string {
  if (!html) return html;
  return html.replace(/<img\b[^>]*>/gi, '');
}

function htmlToText(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function CommentWithContext({ c, filterTeam, filterName, viewMode }: { c: FB; filterTeam?: string; filterName?: string; viewMode?: 'summary' | 'full' }) {
  const [wl, setWl] = useState<any | null>(null);
  const [prev, setPrev] = useState<Array<{ id: string; authorName?: string; content: string; createdAt: string }>>([]);
  useEffect(() => {
    (async () => {
      try {
        const w = await apiJson<any>(`/api/worklogs/${encodeURIComponent(c.subjectId)}`);
        setWl(w);
      } catch {}
      try {
        const fbr = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=Worklog&subjectId=${encodeURIComponent(c.subjectId)}&limit=20`);
        const items = (fbr.items || []).map((x: any) => ({ id: x.id, authorName: x.authorName, content: x.content, createdAt: x.createdAt }));
        const before = items.filter((x) => x.id !== c.id).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        setPrev(before);
      } catch {}
    })();
  }, [c.subjectId, c.id]);
  const matches = (!filterTeam || ((wl?.teamName || '').toLowerCase().includes(filterTeam.toLowerCase()))) && (!filterName || ((wl?.userName || '').toLowerCase().includes(filterName.toLowerCase())));
  if ((filterTeam || filterName) && !matches) return null;
  const title = (wl?.note || '').split('\n')[0] || '';
  const attachments = wl?.attachments || {};
  const files = attachments?.files || [];
  const firstImg = (() => {
    const fileImg = files.find((f: any) => /(png|jpe?g|gif|webp|bmp|svg)$/i.test((f.url || f.name || '')));
    if (fileImg) return absLink(fileImg.url as string);
    const html = attachments?.contentHtml || '';
    if (html) {
      const abs = absolutizeUploads(html);
      const m = abs.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m && m[1]) return m[1];
    }
    return '';
  })();
  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 10, display: 'grid', gap: 8, background: '#FFFFFF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {firstImg ? (
          <img src={firstImg} alt="thumb" style={{ width: 84, height: 84, borderRadius: 8, objectFit: 'cover', flex: '0 0 auto' }} />
        ) : (
          <div style={{ width: 84, height: 84, borderRadius: 8, background: '#f1f5f9', flex: '0 0 auto' }} />
        )}
        <div style={{ display: 'grid', gap: 4, flex: 1 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ fontWeight: 700 }}>{title || '(제목 없음)'}</div>
            <div style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>· {(wl?.userName || '')}{wl?.teamName ? ` · ${wl.teamName}` : ''} · {formatKstYmd(c.createdAt)}{(wl as any)?.visibility ? ` · 조회권한 ${visibilityKo((wl as any).visibility)}` : ''}</div>
          </div>
        </div>
      </div>
      {viewMode === 'full' && wl && (
        <WorklogDocument worklog={wl} variant="content" />
      )}
      <div style={{ display: 'grid', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
        {prev.map((p) => (
          <div key={p.id}>
            <div style={{ fontSize: 12, color: '#475569' }}>{p.authorName || '익명'} · {formatKstYmd(p.createdAt)}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{p.content}</div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 12, color: '#475569' }}>{c.authorName || '익명'} · {formatKstYmd(c.createdAt)}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
        </div>
      </div>
    </div>
  );
}

function CommentsBox({ worklogId }: { worklogId: string }) {
  const [items, setItems] = useState<Array<{ id: string; authorName?: string; content: string; createdAt: string }>>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiJson<{ items: any[] }>(`/api/feedbacks?subjectType=${encodeURIComponent('Worklog')}&subjectId=${encodeURIComponent(worklogId)}&limit=100`);
      setItems((r.items || []).map((x: any) => ({ id: x.id, authorName: x.authorName, content: x.content, createdAt: x.createdAt })));
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
                <div style={{ fontSize: 12, color: '#475569' }}>{c.authorName || '익명'} · {formatKstYmd(c.createdAt)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
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
