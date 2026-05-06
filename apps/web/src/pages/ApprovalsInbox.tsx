import { useEffect, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { WorklogDocument } from '../components/WorklogDocument';
import { ProcessDocument } from '../components/ProcessDocument';
import { UserAvatar } from '../components/UserAvatar';

export function ApprovalsInbox() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<any | null>(null);
  const [comment, setComment] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [worklogPopup, setWorklogPopup] = useState<{ id: string; title: string; contentHtml: string; note: string; files?: any[]; createdAt: string; createdBy?: { name: string } } | null>(null);

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
    if (uid) setUserId(uid);
  }, []);

  useEffect(() => {
    if (userId) void load();
  }, [userId, statusFilter]);

  async function load() {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('approverId', userId);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const res = await apiJson<{ items: any[] }>(`/api/approvals?${params.toString()}`);
      const base = (res.items || []).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      // Batch fetch all subject docs in one call to avoid N+1
      let docMap: Record<string, any> = {};
      try {
        const batchItems = base.map((a: any) => ({ subjectType: String(a.subjectType || ''), subjectId: String(a.subjectId || '') }));
        const batchRes = await apiJson<{ results: Record<string, any> }>(`/api/approvals/batch-subjects`, {
          method: 'POST',
          body: JSON.stringify({ items: batchItems }),
        });
        docMap = batchRes.results || {};
      } catch {}
      const enriched = base.map((a: any) => {
        const stNorm = String(a.subjectType || '').toUpperCase();
        const key = `${a.subjectType}::${a.subjectId}`;
        const doc = docMap[key] ?? null;
        const finalDoc = stNorm === 'PROCESS' && doc ? { process: doc, summaryTasks: [], pendingTask: null } : doc;
        return { ...a, _doc: finalDoc, _stNorm: stNorm };
      });
      setItems(enriched);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function approve(requestId: string, cmt?: string) {
    setError(null);
    try {
      await apiJson(`/api/approvals/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment: cmt || undefined }) });
      await load();
    } catch (e: any) {
      const msg = e?.message || '승인 처리에 실패했습니다.';
      setError(msg);
      try { window.alert(`승인 실패: ${msg}`); } catch {}
    }
  }

  async function reject(requestId: string, cmt?: string) {
    const bodyComment = typeof cmt === 'string' ? cmt : (window.prompt('반려 사유를 입력하세요') || '');
    setError(null);
    try {
      await apiJson(`/api/approvals/${requestId}/reject`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment: bodyComment }) });
      await load();
    } catch (e: any) {
      const msg = e?.message || '반려 처리에 실패했습니다.';
      setError(msg);
      try { window.alert(`반려 실패: ${msg}`); } catch {}
    }
  }

  // Determine whether the current user is the active approver for a request.
  // The Approve/Reject endpoints only accept actions from the *current* step's
  // approver, so showing the buttons to anyone else creates dead clicks.
  function isCurrentApprover(a: any): boolean {
    if (!userId) return false;
    if (String(a?.status || '') !== 'PENDING') return false;
    const steps = Array.isArray(a?.steps) ? a.steps : [];
    if (steps.length > 0) {
      const pending = steps.find((s: any) => s?.status === 'PENDING');
      return Boolean(pending && String(pending.approverId || '') === userId);
    }
    return String(a?.currentApprover?.id || '') === userId;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, color: '#475569' }}>상태</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={input}>
          <option value="PENDING">미승인</option>
          <option value="APPROVED">승인</option>
          <option value="REJECTED">반려</option>
          <option value="ALL">전체</option>
        </select>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((a) => {
          const doc = (a as any)._doc as any | null;
          const stNorm = String((a as any)._stNorm || a.subjectType || '').toUpperCase();
          let title = '문서 정보 없음';
          let meta = '';
          let when = a.createdAt as string | undefined;

          if (stNorm === 'CAR_DISPATCH' && doc) {
            title = `배차 신청 - ${doc.carName || ''}`.trim();
            const timeRange = doc.startAt && doc.endAt
              ? `${new Date(doc.startAt).toLocaleString()} ~ ${new Date(doc.endAt).toLocaleString()}`
              : '';
            const parts = [
              doc.requesterName || '',
              timeRange,
              doc.destination || '',
              doc.purpose || '',
              doc.coRiders ? `동승자: ${doc.coRiders}` : '',
            ].filter(Boolean);
            meta = parts.join(' · ');
            when = doc.createdAt || doc.startAt || when;
          } else if (stNorm === 'ATTENDANCE' && doc) {
            let kind: string;
            if (doc.type === 'OT') kind = 'OT';
            else if (doc.type === 'VACATION') kind = '휴가';
            else if (doc.type === 'EARLY_LEAVE') kind = '조퇴';
            else if (doc.type === 'FLEXIBLE') kind = '유연근무';
            else if (doc.type === 'HOLIDAY_WORK' || doc.type === 'HOLIDAY_REST') kind = '휴일 대체 신청';
            else kind = doc.type;

            title = `근태 신청 - ${kind}`.trim();
            const dateStr = doc.date ? new Date(doc.date).toLocaleDateString() : '';
            const timeRange = doc.startAt && doc.endAt
              ? `${new Date(doc.startAt).toLocaleTimeString()} ~ ${new Date(doc.endAt).toLocaleTimeString()}`
              : (doc.type === 'VACATION' || doc.type === 'HOLIDAY_REST' ? '종일' : '');
            const parts = [
              doc.requesterName || '',
              dateStr,
              timeRange,
              doc.reason || '',
            ].filter(Boolean);
            meta = parts.join(' · ');
            when = doc.createdAt || doc.date || when;
          } else if (stNorm === 'WORKLOG' && doc) {
            const wl = doc;
            title = ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)');
            const who = wl?.createdBy?.name || wl.userName || '';
            const team = wl?.createdBy?.orgUnit?.name || wl.teamName || '';
            const whoId = wl?.createdById || wl?.createdBy?.id || '';
            meta = (
              <span>
                {who}
                <UserAvatar userId={String(whoId || '')} name={String(who || '')} size={14} style={{ marginLeft: 4 }} />
                {team ? ` · ${team}` : ''}
              </span>
            ) as any;
            when = wl?.date || wl?.createdAt || when;
          } else if (stNorm === 'PROCESS' && doc) {
            const inst = doc.process;
            title = `프로세스 결재 - ${(inst?.title || '').trim()}`;
            const parts = [
              inst?.startedBy?.name ? `시작자: ${inst.startedBy.name}` : '',
              inst?.startAt ? `시작: ${new Date(inst.startAt).toLocaleString()}` : '',
              inst?.status ? `상태: ${inst.status}` : '',
            ].filter(Boolean);
            const startedById = inst?.startedBy?.id || '';
            meta = (
              <span>
                {inst?.startedBy?.name ? (
                  <>
                    시작자: {inst.startedBy.name} <UserAvatar userId={String(startedById || '')} name={String(inst.startedBy.name || '')} size={14} style={{ marginLeft: 4 }} />
                  </>
                ) : null}
                {inst?.startAt ? ` · 시작: ${new Date(inst.startAt).toLocaleString()}` : ''}
                {inst?.status ? ` · 상태: ${inst.status}` : ''}
              </span>
            ) as any;
            when = inst?.createdAt || when;
          }
          const reqName = String(a.requestedBy?.name || '');
          const reqId = String(a.requestedBy?.id || '');
          const mine = isCurrentApprover(a);
          const tb = turnBadge(mine, String(a.status || ''));
          return (
            <div key={a.id} style={compactCard} onClick={() => setActive(a)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, flexWrap: 'wrap' as any }}>
                <span style={chip}>{statusLabel(a.status)}</span>
                <span style={tb.style}>{tb.label}</span>
                {reqId && <UserAvatar userId={reqId} name={reqName} size={22} />}
                {reqName && <span style={{ fontSize: 13, color: '#334155', fontWeight: 600, flexShrink: 0 }}>{reqName}</span>}
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{title}</span>
                <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{when ? new Date(when).toLocaleDateString() : ''}</span>
                {a.status === 'PENDING' && mine && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); approve(a.id); }} style={compactPrimaryBtn}>승인</button>
                    <button onClick={(e) => { e.stopPropagation(); reject(a.id); }} style={compactGhostBtn}>반려</button>
                  </>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <ApprovalStepLadder
                  steps={(a.steps || []) as ApprovalStep[]}
                  currentApproverId={String(a?.currentApprover?.id || '')}
                  mineId={userId}
                  variant="row"
                />
              </div>
            </div>
          );
        })}
        {!items.length && <div>해당 상태의 결재 없음</div>}
      </div>
      {active && (
        <div style={modalOverlay} onClick={() => setActive(null)}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            {(() => {
              const n = active;
              const doc = (n as any)._doc as any | null;
              const stNorm = String((n as any)._stNorm || n.subjectType || '').toUpperCase();
              let title = '문서 정보 없음';
              let meta = '';
              let when = n.createdAt as string | undefined;

              if (stNorm === 'CAR_DISPATCH' && doc) {
                title = `배차 신청 - ${doc.carName || ''}`.trim();
                const timeRange = doc.startAt && doc.endAt
                  ? `${new Date(doc.startAt).toLocaleString()} ~ ${new Date(doc.endAt).toLocaleString()}`
                  : '';
                const parts = [
                  doc.requesterName || '',
                  timeRange,
                  doc.destination || '',
                  doc.purpose || '',
                  doc.coRiders ? `동승자: ${doc.coRiders}` : '',
                ].filter(Boolean);
                meta = parts.join(' · ');
                when = doc.createdAt || doc.startAt || when;
              } else if (stNorm === 'ATTENDANCE' && doc) {
                let kind: string;
                if (doc.type === 'OT') kind = 'OT';
                else if (doc.type === 'VACATION') kind = '휴가';
                else if (doc.type === 'EARLY_LEAVE') kind = '조퇴';
                else if (doc.type === 'FLEXIBLE') kind = '유연근무';
                else if (doc.type === 'HOLIDAY_WORK' || doc.type === 'HOLIDAY_REST') kind = '휴일 대체 신청';
                else kind = doc.type;

                title = `근태 신청 - ${kind}`.trim();
                const dateStr = doc.date ? new Date(doc.date).toLocaleDateString() : '';
                const timeRange = doc.startAt && doc.endAt
                  ? `${new Date(doc.startAt).toLocaleTimeString()} ~ ${new Date(doc.endAt).toLocaleTimeString()}`
                  : (doc.type === 'VACATION' || doc.type === 'HOLIDAY_REST' ? '종일' : '');
                const parts = [
                  doc.requesterName || '',
                  dateStr,
                  timeRange,
                  doc.reason || '',
                ].filter(Boolean);
                meta = parts.join(' · ');
                when = doc.createdAt || doc.date || when;
              } else if (stNorm === 'WORKLOG' && doc) {
                const wl = doc;
                title = ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)');
                const who = wl?.createdBy?.name || wl.userName || '';
                const team = wl?.createdBy?.orgUnit?.name || wl.teamName || '';
                meta = `${who}${team ? ` · ${team}` : ''}`;
                when = wl?.date || wl?.createdAt || when;
              } else if (stNorm === 'PROCESS' && doc) {
                const inst = doc.process;
                title = `프로세스 결재 - ${(inst?.title || '').trim()}`;
                const parts = [
                  inst?.startedBy?.name ? `시작자: ${inst.startedBy.name}` : '',
                  inst?.startAt ? `시작: ${new Date(inst.startAt).toLocaleString()}` : '',
                  inst?.status ? `상태: ${inst.status}` : '',
                ].filter(Boolean);
                meta = parts.join(' · ');
                when = inst?.createdAt || when;
              }
              const mine = isCurrentApprover(n);
              const tb = turnBadge(mine, String(n.status || ''));
              return (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as any }}>
                    <b>{title}</b>
                    <span style={chip}>{statusLabel(n.status)}</span>
                    <span style={tb.style}>{tb.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
                  </div>
                  <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 10, display: 'grid', gap: 6 }}>
                    <div style={{ fontSize: 11, color: '#475569', fontWeight: 700 }}>결재 단계</div>
                    <ApprovalStepLadder
                      steps={(n.steps || []) as ApprovalStep[]}
                      currentApproverId={String(n?.currentApprover?.id || '')}
                      mineId={userId}
                      variant="modal"
                    />
                  </div>
                  {meta && <div style={{ fontSize: 12, color: '#334155' }}>{meta}</div>}
                  {stNorm === 'WORKLOG' && doc && (
                    <div style={{ marginTop: 6, maxHeight: 520, overflow: 'auto' }}>
                      <WorklogDocument worklog={doc} variant="full" />
                    </div>
                  )}
                  {stNorm === 'PROCESS' && doc && (
                    <div style={{ marginTop: 8 }}>
                      <ProcessDocument processDoc={doc} variant="full" onOpenWorklog={(wl) => setWorklogPopup(wl)} />
                    </div>
                  )}
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
                      {n.status === 'PENDING' && isCurrentApprover(n) && (
                        <>
                          <button
                            onClick={async () => {
                              await approve(active.id, comment);
                              setComment('');
                              setActive(null);
                            }}
                            style={primaryBtn}
                          >
                            승인
                          </button>
                          <button
                            onClick={async () => {
                              await reject(active.id, comment || undefined);
                              setComment('');
                              setActive(null);
                            }}
                            style={ghostBtn}
                          >
                            반려
                          </button>
                        </>
                      )}
                      {n.status === 'PENDING' && !isCurrentApprover(n) && (
                        <div style={{ fontSize: 12, color: '#64748b' }}>
                          이전 결재자의 승인을 기다리고 있습니다{n?.currentApprover?.name ? ` (현 차례: ${n.currentApprover.name})` : ''}.
                        </div>
                      )}
                      <button onClick={() => { setComment(''); setActive(null); }} style={ghostBtn}>닫기</button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
      {worklogPopup && (
        <div style={modalOverlay} onClick={() => setWorklogPopup(null)}>
          <div style={modalBody} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b>{(worklogPopup.note || '').split('\n')[0] || worklogPopup.title || '업무일지'}</b>
              <button style={ghostBtn} onClick={() => setWorklogPopup(null)}>닫기</button>
            </div>
            <WorklogDocument
              worklog={worklogPopup}
              variant="full"
            />
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

const compactCard: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E5E7EB',
  borderRadius: 8,
  padding: '8px 12px',
  cursor: 'pointer',
};

const compactPrimaryBtn: React.CSSProperties = {
  background: '#0F3D73',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 6,
  padding: '4px 12px',
  fontSize: 12,
  fontWeight: 600,
  flexShrink: 0,
};

const compactGhostBtn: React.CSSProperties = {
  background: 'transparent',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 6,
  padding: '4px 12px',
  fontSize: 12,
  fontWeight: 600,
  flexShrink: 0,
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
  return html.replace(/(src|href)=["'](\/(api\/)?(uploads|files)\/[^"']+)["']/g, (_m, attr, p) => `${attr}="${apiUrl(p)}"`);
}

function absLink(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return apiUrl(url);
}

function pickFileUrl(f: any): string {
  if (!f) return '';
  if (typeof f === 'string') return f;
  return String(f.url || f.path || f.href || f.downloadUrl || '');
}

function pickFileName(f: any, url: string): string {
  if (f && typeof f === 'object') {
    const n = f.name || f.originalName || f.filename;
    if (n) return String(n);
  }
  try {
    const last = decodeURIComponent((url.split('/').pop() || url));
    return last || url;
  } catch {
    return url;
  }
}

function isImageAttachment(f: any, url: string): boolean {
  if (f && typeof f === 'object') {
    const t = String(f.type || '').toLowerCase();
    if (t.startsWith('image/')) return true;
    const n = String(f.name || f.originalName || f.filename || '').toLowerCase();
    if (/(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return true;
  }
  return /(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
}

type ApprovalStep = {
  id: string;
  stepNo: number;
  approverId?: string;
  approver?: { id: string; name: string } | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  actedAt?: string | null;
  comment?: string | null;
};

function stepDisplayStatus(steps: ApprovalStep[], step: ApprovalStep): 'DONE' | 'CURRENT' | 'WAITING' | 'REJECTED' {
  if (step.status === 'APPROVED') return 'DONE';
  if (step.status === 'REJECTED') return 'REJECTED';
  // PENDING: only the *first* PENDING step is current; the rest are upcoming.
  const firstPending = steps.find((s) => s.status === 'PENDING');
  if (firstPending && firstPending.id === step.id) return 'CURRENT';
  return 'WAITING';
}

function ApprovalStepLadder({ steps, currentApproverId, mineId, variant = 'row' }: {
  steps: ApprovalStep[];
  currentApproverId?: string;
  mineId?: string;
  variant?: 'row' | 'modal';
}) {
  const list = (steps || []).slice().sort((a, b) => (a.stepNo || 0) - (b.stepNo || 0));
  if (list.length === 0) {
    // Single-step: synthesize one pseudo-step from currentApprover info.
    if (!currentApproverId) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as any }}>
        <span style={pillStyle('CURRENT')}>1. 결재자</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as any }}>
      {list.map((s, idx) => {
        const ds = stepDisplayStatus(list, s);
        const isMe = Boolean(mineId && String(s.approverId || s.approver?.id || '') === mineId);
        return (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={pillStyle(ds, isMe)} title={s.comment ? `의견: ${s.comment}` : undefined}>
              <span style={{ fontWeight: 800, marginRight: 4, opacity: 0.8 }}>{s.stepNo}.</span>
              {s.approver?.name || '결재자'}
              {isMe && <span style={{ marginLeft: 4, fontWeight: 800 }}>(나)</span>}
              <span style={{ marginLeft: 6 }}>{stepIcon(ds)}</span>
            </span>
            {variant === 'modal' && s.actedAt && (
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(s.actedAt).toLocaleString()}</span>
            )}
            {idx < list.length - 1 && <span style={{ color: '#cbd5e1' }}>→</span>}
          </span>
        );
      })}
    </div>
  );
}

function pillStyle(ds: 'DONE' | 'CURRENT' | 'WAITING' | 'REJECTED', isMe?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 11,
    padding: '2px 8px',
    borderRadius: 999,
    border: '1px solid',
    fontWeight: 600,
    whiteSpace: 'nowrap',
  };
  if (ds === 'DONE') return { ...base, background: '#ECFDF5', color: '#065F46', borderColor: '#A7F3D0' };
  if (ds === 'REJECTED') return { ...base, background: '#FEF2F2', color: '#991B1B', borderColor: '#FECACA' };
  if (ds === 'CURRENT') return {
    ...base,
    background: isMe ? '#0F3D73' : '#FFF7ED',
    color: isMe ? '#FFFFFF' : '#9A3412',
    borderColor: isMe ? '#0F3D73' : '#FED7AA',
  };
  return { ...base, background: '#F8FAFC', color: '#64748B', borderColor: '#E2E8F0' };
}

function stepIcon(ds: 'DONE' | 'CURRENT' | 'WAITING' | 'REJECTED'): string {
  if (ds === 'DONE') return '✓';
  if (ds === 'REJECTED') return '✗';
  if (ds === 'CURRENT') return '●';
  return '◌';
}

function turnBadge(isMine: boolean, status: string): { label: string; style: React.CSSProperties } {
  if (status !== 'PENDING') {
    const label = status === 'APPROVED' ? '승인 완료' : status === 'REJECTED' ? '반려됨' : status;
    return {
      label,
      style: { display: 'inline-flex', alignItems: 'center', fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 800, background: '#F1F5F9', color: '#334155', border: '1px solid #CBD5E1', whiteSpace: 'nowrap' },
    };
  }
  if (isMine) {
    return {
      label: '내 차례',
      style: { display: 'inline-flex', alignItems: 'center', fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 800, background: '#16A34A', color: '#FFFFFF', border: '1px solid #15803D', whiteSpace: 'nowrap' },
    };
  }
  return {
    label: '내 차례 아님',
    style: { display: 'inline-flex', alignItems: 'center', fontSize: 11, padding: '2px 8px', borderRadius: 999, fontWeight: 700, background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A', whiteSpace: 'nowrap' },
  };
}

function statusLabel(s?: string): string {
  if (s === 'APPROVED') return '승인';
  if (s === 'REJECTED') return '반려';
  if (s === 'EXPIRED') return '만료';
  return '미승인';
}

const chip: React.CSSProperties = {
  background: '#E6EEF7',
  color: '#0F3D73',
  border: '1px solid #0F3D73',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 12,
  fontWeight: 700,
};
