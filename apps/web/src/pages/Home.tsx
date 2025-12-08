import { useEffect, useMemo, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

type WL = { id: string; title: string; excerpt: string; userName?: string; teamName?: string; date: string };
type FB = { id: string; subjectId: string; authorName?: string; content: string; createdAt: string };

export function Home() {
  const [worklogs, setWorklogs] = useState<WL[]>([]);
  const [urgentWls, setUrgentWls] = useState<WL[]>([]);
  const [comments, setComments] = useState<FB[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [filterTeam, setFilterTeam] = useState('');
  const [filterName, setFilterName] = useState('');
  const [viewMode, setViewMode] = useState<'summary'|'full'>('summary');
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

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const wl = await apiJson<{ items: WL[] }>(`/api/worklogs/search?limit=40`);
        setWorklogs(wl.items || []);
        try {
          const uw = await apiJson<{ items: WL[] }>(`/api/worklogs/search?limit=20&urgent=true`);
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any }}>
          <option value="">팀 전체</option>
          {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterName} onChange={(e) => setFilterName(e.target.value)} style={{ border: '1px solid #CBD5E1', borderRadius: 8, padding: '6px 10px', appearance: 'auto' as any }}>
          <option value="">이름 전체</option>
          {nameOptions.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className={viewMode==='summary' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('summary')}>요약</button>
          <button className={viewMode==='full' ? 'btn btn-primary' : 'btn'} onClick={() => setViewMode('full')}>전체</button>
        </div>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1.8fr 1fr' }}>
        <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 업무일지</div>
          {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
            <div style={{ display: 'grid', gap: 8 }}>
              {worklogs
                .filter((w) => !filterTeam || (w.teamName||'').toLowerCase().includes(filterTeam.toLowerCase()))
                .filter((w) => !filterName || (w.userName||'').toLowerCase().includes(filterName.toLowerCase()))
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
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 700 }}>{w.title || '(제목 없음)'}</div>
                          <div style={{ fontSize: 12, color: '#475569' }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstDatetime(w.date)}</div>
                        </div>
                        {viewMode==='summary' && (
                          <div style={{ color: '#334155' }}>{snippet}</div>
                        )}
                      </div>
                    </div>
                    {viewMode === 'full' && (
                      contentHtml ? (
                        <div className="rich-content" onClick={(e) => { e.stopPropagation(); onContentClick(e); }} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(contentHtml) }} />
                      ) : (
                        <div style={{ color: '#334155' }}>{contentText}</div>
                      )
                    )}
                  </div>
                );
              })}
              {!worklogs.length && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>긴급 보고</div>
            <div style={{ height: 220, overflowY: 'scroll', display: 'grid', gap: 8 }}>
              {urgentWls.map((w) => {
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
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 800, color: '#dc2626' }}>{w.title || '(제목 없음)'}</div>
                          <div style={{ fontSize: 12, color: '#475569' }}>· {w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstDatetime(w.date)}</div>
                        </div>
                        <div style={{ color: '#334155' }}>{snippet}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!urgentWls.length && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
            </div>
          </div>
          <div style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 댓글</div>
            <div style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 8 }}>
              {latestComments.map((c) => (
                <CommentWithContext key={c.subjectId} c={c} filterTeam={filterTeam} filterName={filterName} viewMode={viewMode} />
              ))}
              {!comments.length && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
            </div>
          </div>
        </div>
      </div>
      
      {zoomSrc && (
        <div className="image-overlay" onClick={() => setZoomSrc(null)}>
          <img src={zoomSrc} alt="preview" />
        </div>
      )}
      {detail && (
        <div className="image-overlay" onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: 16, borderRadius: 12, maxWidth: 1200, width: '96%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
              <div style={{ width: 22, height: 22, borderRadius: 999, background: '#E2E8F0', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{String((detail as any).userName || '?').slice(0,1)}</div>
              <div>{(detail as any).userName || ''}</div>
              <div>·</div>
              <div>{(detail as any).teamName || ''}</div>
              <div style={{ marginLeft: 'auto', background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{formatKstDatetime((detail as any).date || (detail as any).createdAt || new Date().toISOString())}</div>
            </div>
            <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>{(detail as any).title}</div>
            {(detail as any)?.attachments?.contentHtml ? (
              <div
                className="rich-content"
                style={{ marginTop: 6, color: '#111827', border: '1px solid #eee', borderRadius: 8, padding: 12 }}
                onClick={onContentClick}
                dangerouslySetInnerHTML={{ __html: absolutizeUploads((detail as any).attachments.contentHtml) }}
              />
            ) : (
              <div style={{ marginTop: 6, color: '#374151' }}>{(detail as any)?.note || ''}</div>
            )}
            {Array.isArray((detail as any)?.attachments?.files) && (detail as any).attachments.files.length > 0 && (
              <div className="attachments" style={{ marginTop: 10 }}>
                {(detail as any).attachments.files.map((f: any, i: number) => {
                  const url = absLink(f.url as string);
                  const name = f.name || f.filename || decodeURIComponent((url.split('/').pop() || url));
                  const isImg = /(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
                  return (
                    <div className="attachment-item" key={(f.filename || f.url) + i}>
                      {isImg ? (
                        <img src={url} alt={name} style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, cursor: 'zoom-in' }} onClick={() => setZoomSrc(url)} />
                      ) : (
                        <a className="file-link" href={url} target="_blank" rel="noreferrer">{name}</a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {(detail as any)?.taskName && <div style={{ marginTop: 10, fontSize: 12, color: '#0F3D73', background: '#E6EEF7', display: 'inline-block', padding: '4px 8px', borderRadius: 999, fontWeight: 600 }}>{(detail as any).taskName}</div>}
            <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
              <CommentsBox worklogId={(detail as any).id} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" onClick={() => setDetail(null)}>닫기</button>
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

function onContentClick(e: React.MouseEvent<HTMLDivElement>) {
  const target = e.target as HTMLElement | null;
  if (target && target.tagName === 'IMG') {
    e.preventDefault();
  }
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
  const contentHtml = wl?.attachments?.contentHtml || '';
  const contentText = (wl?.note || '').split('\n').slice(1).join('\n');
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>{title || '(제목 없음)'}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>· {(wl?.userName || '')}{wl?.teamName ? ` · ${wl.teamName}` : ''} · {formatKstDatetime((wl?.date || wl?.createdAt || c.createdAt) as any)}</div>
          </div>
        </div>
      </div>
      {viewMode === 'full' && (
        contentHtml ? (
          <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(stripImgs(contentHtml)) }} />
        ) : (
          <div style={{ color: '#334155' }}>{contentText}</div>
        )
      )}
      <div style={{ display: 'grid', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
        {prev.map((p) => (
          <div key={p.id}>
            <div style={{ fontSize: 12, color: '#475569' }}>{p.authorName || '익명'} · {formatKstDatetime(p.createdAt)}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{p.content}</div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 12, color: '#475569' }}>{c.authorName || '익명'} · {formatKstDatetime(c.createdAt)}</div>
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
                <div style={{ fontSize: 12, color: '#475569' }}>{c.authorName || '익명'} · {formatKstDatetime(c.createdAt)}</div>
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
