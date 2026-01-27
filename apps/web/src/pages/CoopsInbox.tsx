import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson, apiUrl } from '../lib/api';
import { CoopDocument } from '../components/CoopDocument';

export function CoopsInbox() {
  const nav = useNavigate();
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ ticket: any; requestWl: any | null; responseWl: any | null } | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'ACCEPTED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'>('ALL');

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
      const res = await apiJson<{ items: any[] }>(`/api/help-tickets?assigneeId=${encodeURIComponent(userId)}&limit=100`);
      const list = (res.items || []).slice().sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setItems(list);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function openDoc(ticket: any) {
    setDocLoading(true);
    setError(null);
    try {
      const reqId = ticket?.requestWorklogId;
      const resId = ticket?.responseWorklogId;
      let requestWl: any | null = null;
      let responseWl: any | null = null;
      try {
        if (reqId) requestWl = await apiJson<any>(`/api/worklogs/${encodeURIComponent(reqId)}`);
      } catch {}
      try {
        if (resId) responseWl = await apiJson<any>(`/api/worklogs/${encodeURIComponent(resId)}`);
      } catch {}
      setActive({ ticket, requestWl, responseWl });
    } catch (e: any) {
      setError(e?.message || '업무일지 로드 실패');
    } finally {
      setDocLoading(false);
    }
  }

  async function act(kind: 'accept' | 'decline', ticketId: string) {
    try {
      if (!ticketId) {
        window.alert('티켓 ID가 없어 업무 요청을 처리할 수 없습니다. 알림 payload를 확인해주세요.');
        return;
      }
      const body: any = { actorId: userId };
      if (kind === 'decline') {
        while (true) {
          const r = window.prompt('거절 사유를 입력하세요');
          if (r == null) return;
          const s = String(r).trim();
          if (!s) {
            window.alert('거절 사유는 필수입니다.');
            continue;
          }
          body.reason = s;
          break;
        }
      }
      await apiJson(`/api/help-tickets/${encodeURIComponent(ticketId)}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
      if (kind === 'accept') {
        window.alert('업무 요청을 수락했습니다.\n\n이 요청은 업무일지에 해당 업무 요청(업무 협조) 과제로 등록됩니다.\n업무일지에서 해당 업무 요청을 선택해 진행 내용을 작성할 수 있으며, "과제 완료"를 체크하면 요청이 완료로 처리됩니다.');
        const go = window.confirm('지금 업무일지(빠른 작성)로 이동할까요?');
        if (go) nav(`/quick?helpTicketId=${encodeURIComponent(ticketId)}`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || '업무 요청 처리 중 오류가 발생했습니다');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setFilter('ALL')} style={filter === 'ALL' ? primaryBtn : ghostBtn}>전체</button>
        <button type="button" onClick={() => setFilter('OPEN')} style={filter === 'OPEN' ? primaryBtn : ghostBtn}>미수신</button>
        <button type="button" onClick={() => setFilter('ACCEPTED')} style={filter === 'ACCEPTED' ? primaryBtn : ghostBtn}>수락</button>
        <button type="button" onClick={() => setFilter('IN_PROGRESS')} style={filter === 'IN_PROGRESS' ? primaryBtn : ghostBtn}>진행</button>
        <button type="button" onClick={() => setFilter('DONE')} style={filter === 'DONE' ? primaryBtn : ghostBtn}>완료</button>
        <button type="button" onClick={() => setFilter('CANCELLED')} style={filter === 'CANCELLED' ? primaryBtn : ghostBtn}>거절</button>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {items
          .filter((t) => {
            if (filter === 'ALL') return true;
            if (filter === 'OPEN') return t.status === 'OPEN';
            if (filter === 'CANCELLED') return t.status === 'CANCELLED';
            if (filter === 'ACCEPTED') return t.status === 'ACCEPTED';
            if (filter === 'IN_PROGRESS') return t.status === 'IN_PROGRESS' || t.status === 'BLOCKED';
            if (filter === 'DONE') return t.status === 'DONE';
            return true;
          })
          .map((t) => {
            const isOpen = t.status === 'OPEN';
            const isCancelled = t.status === 'CANCELLED';
            const canWrite = t.status === 'ACCEPTED' || t.status === 'IN_PROGRESS' || t.status === 'BLOCKED';
            return (
              <div key={t.id} style={card} onClick={() => openDoc(t)}>
                <CoopDocument ticket={t} variant="compact" />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  {isOpen && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); act('accept', t.id); }} style={primaryBtn}>수락</button>
                      <button onClick={(e) => { e.stopPropagation(); act('decline', t.id); }} style={ghostBtn}>거절</button>
                    </>
                  )}
                  {canWrite && (
                    <button onClick={(e) => { e.stopPropagation(); nav(`/quick?helpTicketId=${encodeURIComponent(t.id)}`); }} style={primaryBtn}>
                      업무일지 작성
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        {!loading && !items.length && <div>내게 할당된 업무 요청 없음</div>}
      </div>
      {active && (
        <div style={modalOverlay} onClick={() => setActive(null)}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const ticket = active.ticket;
              const requestWl = active.requestWl;
              const responseWl = active.responseWl;
              const isOpen = ticket?.status === 'OPEN';
              const isCancelled = ticket?.status === 'CANCELLED';
              const canWrite = ticket?.status === 'ACCEPTED' || ticket?.status === 'IN_PROGRESS' || ticket?.status === 'BLOCKED';
              return (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ marginTop: 6, maxHeight: 520, overflow: 'auto' }}>
                    <CoopDocument ticket={ticket} requestWorklog={requestWl} responseWorklog={responseWl} variant="full" />
                  </div>
                  {docLoading && <div style={{ fontSize: 12, color: '#94a3b8' }}>업무일지 불러오는 중…</div>}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {isOpen && (
                      <>
                        <button onClick={() => act('accept', ticket.id)} style={primaryBtn}>수락</button>
                        <button onClick={() => act('decline', ticket.id)} style={ghostBtn}>거절</button>
                      </>
                    )}
                    {canWrite && (
                      <button onClick={() => nav(`/quick?helpTicketId=${encodeURIComponent(ticket.id)}`)} style={primaryBtn}>업무일지 작성</button>
                    )}
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
