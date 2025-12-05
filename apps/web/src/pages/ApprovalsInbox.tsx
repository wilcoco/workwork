import { useEffect, useState } from 'react';
import { apiFetch, apiJson } from '../lib/api';

export function ApprovalsInbox() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
    if (uid) setUserId(uid);
  }, []);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/inbox?userId=${encodeURIComponent(userId)}&onlyUnread=false`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      const base = (json?.items || []).filter((n: any) => n.type === 'ApprovalRequested');
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

  async function approve(requestId: string, notificationId: string) {
    await apiJson(`/api/approvals/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ actorId: userId }) });
    await markRead(notificationId);
  }

  async function reject(requestId: string, notificationId: string) {
    const comment = window.prompt('반려 사유를 입력하세요') || '';
    await apiJson(`/api/approvals/${requestId}/reject`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment }) });
    await markRead(notificationId);
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>결재하기</h2>
      <div style={{ display: 'flex', gap: 12 }}>
        <input placeholder="내 User ID" value={userId} onChange={(e) => setUserId(e.target.value)} style={input} />
        <button onClick={load} disabled={!userId || loading} style={primaryBtn}>{loading ? '로딩…' : '불러오기'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((n) => {
          const wl = (n as any)._doc as any | null;
          const title = wl ? ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)') : `${n.subjectType} / ${n.subjectId}`;
          const meta = wl ? `${wl.userName || ''}${wl.teamName ? ` · ${wl.teamName}` : ''}` : '';
          const when = wl?.date || wl?.createdAt || n.createdAt;
          const contentHtml = wl?.attachments?.contentHtml || '';
          const contentText = wl ? (wl.note || '').split('\n').slice(1).join('\n') : '';
          const snippetSrc = contentHtml ? stripImgs(contentHtml).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') : contentText;
          const snippet = (snippetSrc || '').trim();
          return (
            <div key={n.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>{title}</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
              </div>
              <div style={{ fontSize: 12, color: '#334155' }}>{meta}</div>
              {snippet && <div style={{ color: '#334155', marginTop: 4 }}>{snippet}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => approve(n.payload?.requestId, n.id)} style={primaryBtn}>승인</button>
                <button onClick={() => reject(n.payload?.requestId, n.id)} style={ghostBtn}>반려</button>
                <button onClick={() => markRead(n.id)} style={ghostBtn}>읽음</button>
              </div>
            </div>
          );
        })}
        {!items.length && <div>대기 중인 결재 없음</div>}
      </div>
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
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 10,
  padding: 12,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.04)'
};

function stripImgs(html: string): string {
  if (!html) return html;
  return html.replace(/<img\b[^>]*>/gi, '');
}
