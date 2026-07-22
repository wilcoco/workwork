import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatKstDatetime } from '../lib/time';

function getNotificationUrl(n: any): string {
  const t = String(n?.type || '').trim();
  const st = String(n?.subjectType || '').toUpperCase();
  const sid = String(n?.subjectId || '');
  if (t === 'ApprovalRequested') return '/approvals/inbox';
  if (t === 'ApprovalGranted' || t === 'ApprovalRejected' || t === 'ApprovalCommented') {
    // 상신자는 올린 결재에서, 결재 참여자는 결재하기에서 보는 게 자연스럽다
    return n?.payload?.forRequester ? '/approvals/mine' : '/approvals/inbox';
  }
  if (st === 'CAR_SWAP' || t === 'CarSwapRequested' || t === 'CarSwapAgreed' || t === 'CarSwapDeclined') return '/dispatch/corporate';
  if (t === 'HelpRequested') return '/coops/inbox';
  if (t === 'Delegated') return '/me/goals';
  if (t === 'ProcessStarted' || t === 'ProcessTaskReady') return sid ? `/process/instances/${encodeURIComponent(sid)}` : '/process/my';
  if (st === 'ATTENDANCE') return '/attendance/request';
  if (st === 'CAR_DISPATCH') return '/dispatch/corporate';
  if (st === 'LOGISTICS_DISPATCH') return '/dispatch/logistics';
  if (st === 'PROCESS' && sid) return `/process/instances/${encodeURIComponent(sid)}`;
  if (st === 'WORKLOG' || st === 'WORKLOGS') return sid ? `/worklogs/${encodeURIComponent(sid)}` : '/';
  if (st === 'HELPTICKET') return '/coops/inbox';
  return '/';
}

function typeLabel(n: any): string {
  const t = String(n?.type || '');
  const st = String(n?.subjectType || '').toUpperCase();
  if (t === 'ApprovalRequested') return '결재 요청';
  if (t === 'ApprovalGranted') return '결재 승인';
  if (t === 'ApprovalRejected') return '결재 반려';
  if (t === 'ApprovalCommented') return '결재 의견';
  if (t === 'HelpRequested') return '업무 요청';
  if (t === 'CarSwapRequested') return '차량 교환 요청';
  if (t === 'CarSwapAgreed') return '차량 교환 동의';
  if (t === 'CarSwapDeclined') return '차량 교환 거절';
  if (st === 'LOGISTICS_DISPATCH') return '물류 배차';
  if (st === 'CAR_DISPATCH') return '법인차 배차';
  if (st === 'ATTENDANCE') return '근태 신청';
  return t || st;
}

export function Inbox() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string>(() => {
    return typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  });
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/inbox?userId=${encodeURIComponent(userId)}&onlyUnread=false`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const json = await res.json();
      setItems(json.items || []);
    } catch (e: any) {
      setError(e.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function markRead(id: string) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorId: userId }) });
    await load();
  }

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
    if (userId) void load();
  }, [userId]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2>인박스</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <input
          placeholder="내 User ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          style={{
            ...input,
            flex: isMobile ? '1 1 100%' : '0 0 auto',
            minWidth: isMobile ? '100%' : undefined,
          }}
        />
        <button onClick={load} disabled={!userId || loading} style={primaryBtn}>{loading ? '로딩...' : '불러오기'}</button>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((n) => {
          const url = getNotificationUrl(n);
          const unread = !n.readAt;
          return (
            <div
              key={n.id}
              style={{ ...card, cursor: 'pointer', borderLeft: unread ? '3px solid #0F3D73' : '3px solid transparent', opacity: unread ? 1 : 0.7 }}
              onClick={async () => {
                if (unread) await markRead(n.id);
                navigate(url);
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                {unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0F3D73', flexShrink: 0, display: 'inline-block' }} />}
                <b style={{ fontSize: 14 }}>{typeLabel(n)}</b>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{formatKstDatetime(n.createdAt)}</span>
              </div>
              <div style={{ fontSize: 12, color: '#475569' }}>{n.subjectType}{n.subjectId ? ` · ${n.subjectId.slice(0, 8)}…` : ''}</div>
              {(() => {
                const p = n.payload || {};
                const t = String(n.type || '');
                const isApproval = t === 'ApprovalGranted' || t === 'ApprovalRejected' || t === 'ApprovalCommented';
                if (!isApproval || (!p.byName && !p.comment)) return null;
                const verb = t === 'ApprovalGranted' ? '최종 승인' : t === 'ApprovalRejected' ? '반려' : '의견과 함께 승인';
                return (
                  <div style={{ fontSize: 12, color: '#334155', marginTop: 3 }}>
                    {p.byName ? <b>{p.byName}</b> : null}{p.byName ? ` — ${verb}` : ''}
                    {p.comment ? <span style={{ color: '#64748b' }}>{' · "'}{String(p.comment).slice(0, 120)}{'"'}</span> : null}
                  </div>
                );
              })()}
            </div>
          );
        })}
        {!items.length && <div>알림 없음</div>}
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
  padding: '6px 10px',
  fontWeight: 600,
};

const card: React.CSSProperties = {
  background: '#F8FAFC',
  border: '1px solid #CBD5E1',
  borderRadius: 10,
  padding: 12,
  boxShadow: '0 2px 10px rgba(16, 24, 40, 0.04)'
};
