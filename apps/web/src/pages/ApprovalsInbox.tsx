import { useEffect, useState } from 'react';
import { apiFetch, apiJson, apiUrl } from '../lib/api';

export function ApprovalsInbox() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<any | null>(null);
  const [comment, setComment] = useState<string>('');

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
    if (uid) setUserId(uid);
  }, []);

  useEffect(() => {
    if (userId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/inbox?userId=${encodeURIComponent(userId)}&onlyUnread=false`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      const base = (json?.items || [])
        .filter((n: any) => n.type === 'ApprovalRequested')
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      // Enrich with underlying Worklog document when available
      const enriched = await Promise.all(base.map(async (n: any) => {
        let doc: any = null;
        if ((n.subjectType === 'Worklog' || n.payload?.subjectType === 'Worklog') && (n.subjectId || n.payload?.subjectId)) {
          const wid = n.subjectId || n.payload?.subjectId;
          try {
            doc = await apiJson<any>(`/api/worklogs/${encodeURIComponent(wid)}`);
          } catch {}
        }
        return { ...n, _doc: doc };
      }));
      setItems(enriched);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: userId }) });
    await load();
  }

  async function approve(requestId: string, notificationId: string, cmt?: string) {
    await apiJson(`/api/approvals/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment: cmt || undefined }) });
    await markRead(notificationId);
  }

  async function reject(requestId: string, notificationId: string, cmt?: string) {
    const bodyComment = typeof cmt === 'string' ? cmt : (window.prompt('반려 사유를 입력하세요') || '');
    await apiJson(`/api/approvals/${requestId}/reject`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment: bodyComment }) });
    await markRead(notificationId);
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((n) => {
          const wl = (n as any)._doc as any | null;
          const title = wl ? ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)') : '문서 정보 없음';
          const meta = wl ? `${wl.userName || ''}${wl.teamName ? ` · ${wl.teamName}` : ''}` : '';
          const when = wl?.date || wl?.createdAt || n.createdAt;
          return (
            <div key={n.id} style={card} onClick={() => setActive(n)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>{title}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
              </div>
              <div style={{ fontSize: 12, color: '#334155' }}>{meta}</div>
              {wl && (
                wl.attachments?.contentHtml ? (
                  <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginTop: 6 }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(wl.attachments.contentHtml) }} />
                ) : (
                  <div style={{ color: '#334155', marginTop: 6 }}>{String(wl.note || '').split('\n').slice(1).join('\n')}</div>
                )
              )}
              {wl?.attachments?.files?.length ? (
                <div className="attachments" style={{ marginTop: 8 }}>
                  {wl.attachments.files.map((f: any, i: number) => {
                    const url = absLink(f.url as string);
                    const name = f.name || f.filename || decodeURIComponent((url.split('/').pop() || url));
                    const isImg = /(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
                    return (
                      <div key={(f.filename || f.url) + i} className="attachment-item">
                        {isImg ? (
                          <img src={url} alt={name} style={{ maxWidth: '100%', height: 'auto', borderRadius: 8 }} />
                        ) : (
                          <a className="file-link" href={url} target="_blank" rel="noreferrer">{name}</a>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={(e) => { e.stopPropagation(); approve(n.payload?.requestId, n.id); }} style={primaryBtn}>승인</button>
                <button onClick={(e) => { e.stopPropagation(); reject(n.payload?.requestId, n.id); }} style={ghostBtn}>반려</button>
                <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} style={ghostBtn}>읽음</button>
              </div>
            </div>
          );
        })}
        {!items.length && <div>대기 중인 결재 없음</div>}
      </div>
      {active && (
        <div style={modalOverlay} onClick={() => setActive(null)}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const n = active;
              const wl = (n as any)._doc as any | null;
              const title = wl ? ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)') : '문서 정보 없음';
              const meta = wl ? `${wl.userName || ''}${wl.teamName ? ` · ${wl.teamName}` : ''}` : '';
              const when = wl?.date || wl?.createdAt || n.createdAt;
              return (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>{title}</b>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
                  </div>
                  {meta && <div style={{ fontSize: 12, color: '#334155' }}>{meta}</div>}
                  {wl && (
                    wl.attachments?.contentHtml ? (
                      <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginTop: 6, maxHeight: 360, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(wl.attachments.contentHtml) }} />
                    ) : (
                      <div style={{ color: '#334155', marginTop: 6, whiteSpace: 'pre-wrap' }}>{String(wl.note || '').split('\n').slice(1).join('\n')}</div>
                    )
                  )}
                  {wl?.attachments?.files?.length ? (
                    <div className="attachments" style={{ marginTop: 8 }}>
                      {wl.attachments.files.map((f: any, i: number) => {
                        const url = absLink(f.url as string);
                        const name = f.name || f.filename || decodeURIComponent((url.split('/').pop() || url));
                        const isImg = /(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
                        return (
                          <div key={(f.filename || f.url) + i} className="attachment-item" style={{ marginBottom: 6 }}>
                            {isImg ? (
                              <img src={url} alt={name} style={{ maxWidth: '100%', height: 'auto', borderRadius: 8 }} />
                            ) : (
                              <a className="file-link" href={url} target="_blank" rel="noreferrer">{name}</a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    <div>
                      <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 4 }}>결재 의견</label>
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        style={{ width: '100%', minHeight: 80, borderRadius: 8, border: '1px solid #CBD5E1', padding: 8, fontSize: 13 }}
                        placeholder="승인 또는 반려 사유를 입력하세요"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        onClick={async () => {
                          await approve(active.payload?.requestId, active.id, comment);
                          setComment('');
                          setActive(null);
                        }}
                        style={primaryBtn}
                      >
                        승인
                      </button>
                      <button
                        onClick={async () => {
                          await reject(active.payload?.requestId, active.id, comment || undefined);
                          setComment('');
                          setActive(null);
                        }}
                        style={ghostBtn}
                      >
                        반려
                      </button>
                      <button onClick={() => { setComment(''); setActive(null); }} style={ghostBtn}>닫기</button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

const input: React.CSSProperties = {
  border: '1px solid #CBD5E1',
  background: '#FFFFFF',
  borderRadius: 10,
  padding: '10px 12px',
  outline: 'none',
};

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#F8FAFC',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: 12,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.04)'
};

const modalOverlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
  padding: 16,
};

const modalBody: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  maxWidth: 900,
  width: '100%',
  maxHeight: '80vh',
  padding: 16,
  overflow: 'auto',
  boxShadow: '0 20px 40px rgba(15, 23, 42, 0.3)',
};

function stripImgs(html: string): string {
  if (!html) return html;
  return html.replace(/<img\b[^>]*>/gi, '');
}

function absolutizeUploads(html: string): string {
  if (!html) return html;
  return html.replace(/(src|href)=["'](\/(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => `${attr}="${apiUrl(p)}"`);
}

function absLink(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}
