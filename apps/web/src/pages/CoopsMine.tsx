// 보낸 협조 리스트: 내가 요청한 HelpTicket들을 상태/대응 업무일지 링크와 함께 보여주는 화면
import { useEffect, useState } from 'react';
import { apiJson } from '../lib/api';

type SentHelp = {
  id: string;
  category: string;
  helpTitle: string | null;
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
};

export function CoopsMine() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<SentHelp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeWl, setActiveWl] = useState<{ ticket: SentHelp; wl: WorklogDetail } | null>(null);
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
      const res = await apiJson<{ items: SentHelp[] }>(`/api/help-tickets/sent?requesterId=${encodeURIComponent(userId)}`);
      setItems(res.items || []);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function openWorklog(item: SentHelp) {
    if (!item.responseWorklogId) return;
    setWlLoading(true);
    setError(null);
    try {
      const wl = await apiJson<WorklogDetail>(`/api/worklogs/${encodeURIComponent(item.responseWorklogId)}`);
      setActiveWl({ ticket: item, wl });
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

  function renderWorklogText(wl: WorklogDetail) {
    const note = String(wl.note || '');
    const lines = note.split(/\n+/);
    const title = lines[0] || '';
    const body = lines.slice(1).join('\n');
    return { title, body };
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {loading && <div>로딩중…</div>}
        {!loading && !items.length && <div>보낸 협조 내역이 없습니다.</div>}
        {!loading && items.map((it) => {
          const canOpen = it.statusLabel === '협조 완료' && !!it.responseWorklogId;
          return (
            <div key={it.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>{renderTitle(it)}</b>
                <span style={{ fontSize: 12, color: '#64748b' }}>({it.category})</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{new Date(it.createdAt).toLocaleString()}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, fontSize: 12, color: '#334155' }}>
                <span>대상자: {it.assigneeName || '-'}</span>
                <span>마감: {it.dueAt ? new Date(it.dueAt).toLocaleDateString() : '-'}</span>
                <span>상태: {renderStatus(it)}</span>
              </div>
              {canOpen && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" style={primaryBtn} onClick={() => openWorklog(it)} disabled={wlLoading}>
                    {wlLoading ? '업무일지 여는중…' : '업무일지 보기'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {activeWl && (
        <div style={modalOverlay} onClick={() => setActiveWl(null)}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const { title, body } = renderWorklogText(activeWl.wl);
              return (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>협조 대응 업무일지</b>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>
                      {activeWl.wl.date ? new Date(activeWl.wl.date).toLocaleString() : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{title || '(제목 없음)'}</div>
                  <div style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#111827' }}>{body}</div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="button" style={primaryBtn} onClick={() => setActiveWl(null)}>닫기</button>
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
