import { useEffect, useState } from 'react';
import { apiFetch, apiJson, apiUrl } from '../lib/api';

export function CoopsInbox() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<any | null>(null);

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
      const res = await apiFetch(`/api/inbox?userId=${encodeURIComponent(userId)}&onlyUnread=true`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      const base = (json?.items || [])
        .filter((n: any) => n.type === 'HelpRequested')
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const enriched = await Promise.all(base.map(async (n: any) => {
        let doc: any = null;
        const wlId = n.payload?.fromWorklogId;
        if (wlId) {
          try {
            doc = await apiJson<any>(`/api/worklogs/${encodeURIComponent(wlId)}`);
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

  async function act(kind: 'accept' | 'start' | 'resolve' | 'decline', ticketId: string, notificationId?: string) {
    try {
      if (!ticketId) {
        window.alert('티켓 ID가 없어 업무 요청을 처리할 수 없습니다. 알림 payload를 확인해주세요.');
        return;
      }
      const body: any = { actorId: userId };
      if (kind === 'decline') body.reason = window.prompt('거절 사유를 입력하세요') || '';
      await apiJson(`/api/help-tickets/${ticketId}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      if (notificationId) await markRead(notificationId);
      await load();
    } catch (e: any) {
      setError(e?.message || '업무 요청 처리 중 오류가 발생했습니다');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((n) => {
          const wl = (n as any)._doc as any | null;
          const title = wl ? ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)') : '문서 정보 없음';
          const requesterInfo = wl ? `📤 요청자: ${wl.userName || '-'}${wl.teamName ? ` · ${wl.teamName}` : ''}` : '';
          const when = wl?.date || wl?.createdAt || n.createdAt;
          return (
            <div key={n.id} style={card} onClick={() => setActive(n)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>{title}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
              </div>
              {requesterInfo && <div style={{ fontSize: 12, color: '#334155' }}>{requesterInfo}</div>}
              {wl && (
                wl.attachments?.contentHtml ? (
                  <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginTop: 6 }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(wl.attachments.contentHtml) }} />
                ) : (
                  <div style={{ color: '#334155', marginTop: 6 }}>{String(wl.note || '').split('\n').slice(1).join('\n')}</div>
                )
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={(e) => { e.stopPropagation(); act('accept', n.payload?.ticketId, n.id); }} style={primaryBtn}>수락</button>
                <button onClick={(e) => { e.stopPropagation(); act('start', n.payload?.ticketId); }} style={ghostBtn}>시작</button>
                <button onClick={(e) => { e.stopPropagation(); act('resolve', n.payload?.ticketId); }} style={ghostBtn}>완료</button>
                <button onClick={(e) => { e.stopPropagation(); act('decline', n.payload?.ticketId, n.id); }} style={ghostBtn}>거절</button>
              </div>
            </div>
          );
        })}
        {!items.length && <div>내게 할당된 업무 요청 없음</div>}
      </div>
      {active && (
        <div style={modalOverlay} onClick={() => setActive(null)}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const n = active;
              const wl = (n as any)._doc as any | null;
              const title = wl ? ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)') : '문서 정보 없음';
              const requesterInfoModal = wl ? `📤 요청자: ${wl.userName || '-'}${wl.teamName ? ` · ${wl.teamName}` : ''}` : '';
              const when = wl?.date || wl?.createdAt || n.createdAt;
              return (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>{title}</b>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
                  </div>
                  {requesterInfoModal && <div style={{ fontSize: 12, color: '#334155' }}>{requesterInfoModal}</div>}
                  {wl && (
                    wl.attachments?.contentHtml ? (
                      <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginTop: 6, maxHeight: 360, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(wl.attachments.contentHtml) }} />
                    ) : (
                      <div style={{ color: '#334155', marginTop: 6, whiteSpace: 'pre-wrap' }}>{String(wl.note || '').split('\n').slice(1).join('\n')}</div>
                    )
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => act('accept', n.payload?.ticketId, n.id)} style={primaryBtn}>수락</button>
                    <button onClick={() => act('start', n.payload?.ticketId)} style={ghostBtn}>시작</button>
                    <button onClick={() => act('resolve', n.payload?.ticketId)} style={ghostBtn}>완료</button>
                    <button onClick={() => act('decline', n.payload?.ticketId, n.id)} style={ghostBtn}>거절</button>
                    <button onClick={() => setActive(null)} style={ghostBtn}>닫기</button>
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
