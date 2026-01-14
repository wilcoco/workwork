// 보낸 업무 요청 리스트: 내가 요청한 HelpTicket들을 상태/대응 업무일지 링크와 함께 보여주는 화면
import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';
import { CoopDocument } from '../components/CoopDocument';

type SentHelp = {
  id: string;
  category: string;
  helpTitle: string | null;
  requestWorklogId?: string | null;
  requestWorklogTitle?: string | null;
  assigneeName: string | null;
  createdAt: string;
  dueAt: string | null;
  status: string;
  statusLabel: string;
  responseWorklogId: string | null;
  responseWorklogTitle: string | null;
};

type WorklogDetail = {
  id: string;
  note?: string | null;
  date?: string;
  createdAt?: string;
  attachments?: any;
  createdBy?: any;
  initiative?: any;
  timeSpentMinutes?: number;
};

export function CoopsMine() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<SentHelp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<{ ticket: SentHelp; requestWl: WorklogDetail | null; responseWl: WorklogDetail | null } | null>(null);
  const [wlLoading, setWlLoading] = useState(false);

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
      const res = await apiJson<{ items: SentHelp[] }>(
        `/api/help-tickets?requesterId=${encodeURIComponent(userId)}&limit=100`
      );
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function openDoc(item: SentHelp) {
    setWlLoading(true);
    setError(null);
    try {
      let requestWl: WorklogDetail | null = null;
      let responseWl: WorklogDetail | null = null;
      const reqId = item.requestWorklogId;
      const resId = item.responseWorklogId;
      try {
        if (reqId) requestWl = await apiJson<WorklogDetail>(`/api/worklogs/${encodeURIComponent(reqId)}`);
      } catch {}
      try {
        if (resId) responseWl = await apiJson<WorklogDetail>(`/api/worklogs/${encodeURIComponent(resId)}`);
      } catch {}
      setActiveDoc({ ticket: item, requestWl, responseWl });
    } catch (e: any) {
      setError(e?.message || '업무일지 로드 실패');
    } finally {
      setWlLoading(false);
    }
  }

  function renderStatus(s: SentHelp) {
    return s.statusLabel || s.status;
  }

  function renderTitle(s: SentHelp) {
    return s.helpTitle || '(제목 없음)';
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {loading && <div>로딩중…</div>}
        {!loading && !items.length && <div>보낸 업무 요청 내역이 없습니다.</div>}
        {!loading && items.map((it) => {
          const canOpen = it.statusLabel === '업무 요청 완료' && !!it.responseWorklogId;
          return (
            <div key={it.id} style={card}>
              <CoopDocument ticket={it} variant="compact" />
              {canOpen && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" style={primaryBtn} onClick={() => openDoc(it)} disabled={wlLoading}>
                    {wlLoading ? '업무일지 여는중…' : '업무일지 보기'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {activeDoc && (
        <div style={modalOverlay} onClick={() => setActiveDoc(null)}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>업무 요청 문서</b>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{new Date(activeDoc.ticket.createdAt).toLocaleString()}</span>
              </div>
              <CoopDocument ticket={activeDoc.ticket} requestWorklog={activeDoc.requestWl} responseWorklog={activeDoc.responseWl} variant="full" />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" style={primaryBtn} onClick={() => setActiveDoc(null)}>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 10,
  padding: '10px 14px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#F8FAFC',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: 12,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.04)',
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
  maxWidth: 600,
  width: '100%',
  maxHeight: '70vh',
  padding: 16,
  overflow: 'auto',
  boxShadow: '0 20px 40px rgba(15, 23, 42, 0.3)',
};
