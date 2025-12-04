import { useEffect, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

type WL = { id: string; title: string; excerpt: string; userName?: string; teamName?: string; date: string };
type FB = { id: string; subjectId: string; authorName?: string; content: string; createdAt: string };

export function Home() {
  const [worklogs, setWorklogs] = useState<WL[]>([]);
  const [comments, setComments] = useState<FB[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const wl = await apiJson<{ items: WL[] }>(`/api/worklogs/search?limit=40`);
        setWorklogs(wl.items || []);
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
      <h2 style={{ margin: 0 }}>홈</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 업무일지</div>
          {loading ? <div style={{ color: '#64748b' }}>불러오는 중…</div> : (
            <div style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 8 }}>
              {worklogs.map((w) => {
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
                return (
                  <div key={w.id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10, display: 'grid', gap: 6, cursor: 'pointer' }} onClick={() => setDetail(anyW)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {firstImg ? (
                        <img src={firstImg} alt="thumb" style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover', flex: '0 0 auto' }} />
                      ) : (
                        <div style={{ width: 64, height: 64, borderRadius: 6, background: '#f1f5f9', flex: '0 0 auto' }} />
                      )}
                      <div style={{ display: 'grid', gap: 2 }}>
                        <div style={{ fontWeight: 700 }}>{w.title || '(제목 없음)'}</div>
                        <div style={{ fontSize: 12, color: '#475569' }}>{w.userName || ''}{w.teamName ? ` · ${w.teamName}` : ''} · {formatKstDatetime(w.date)}</div>
                      </div>
                    </div>
                    {contentHtml ? (
                      <div className="rich-content" onClick={(e) => { e.stopPropagation(); onContentClick(e); }} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(stripImgs(contentHtml)) }} />
                    ) : (
                      <div style={{ color: '#334155' }}>{contentText}</div>
                    )}
                  </div>
                );
              })}
              {!worklogs.length && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
            </div>
          )}
        </div>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>최근 댓글</div>
          <div style={{ maxHeight: 360, overflowY: 'auto', display: 'grid', gap: 8 }}>
            {comments.map((c) => (
              <CommentWithContext key={c.id} c={c} />
            ))}
            {!comments.length && <div style={{ color: '#94a3b8' }}>표시할 항목이 없습니다.</div>}
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
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', padding: 16, borderRadius: 12, maxWidth: 720, width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 13 }}>
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

function onContentClick(e: React.MouseEvent<HTMLDivElement>) {
  const target = e.target as HTMLElement | null;
  if (target && target.tagName === 'IMG') {
    e.preventDefault();
  }
}

function CommentWithContext({ c }: { c: FB }) {
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
  const title = (wl?.note || '').split('\n')[0] || '';
  const contentHtml = wl?.attachments?.contentHtml || '';
  const contentText = (wl?.note || '').split('\n').slice(1).join('\n');
  return (
    <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10, display: 'grid', gap: 6 }}>
      <div style={{ fontWeight: 700 }}>{title || '(제목 없음)'}</div>
      {contentHtml ? (
        <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10 }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(stripImgs(contentHtml)) }} />
      ) : (
        <div style={{ color: '#334155' }}>{contentText}</div>
      )}
      {prev.length ? (
        <div style={{ display: 'grid', gap: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
          {prev.map((p) => (
            <div key={p.id}>
              <div style={{ fontSize: 12, color: '#475569' }}>{p.authorName || '익명'} · {formatKstDatetime(p.createdAt)}</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{p.content}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div>
        <div style={{ fontSize: 12, color: '#475569' }}>{c.authorName || '익명'} · {formatKstDatetime(c.createdAt)}</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
      </div>
    </div>
  );
}
