import { useEffect, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';

export function ApprovalsInbox() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<any | null>(null);
  const [comment, setComment] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');

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
      const enriched = await Promise.all(base.map(async (a: any) => {
        let doc: any = null;
        const st = a.subjectType;
        const sid = a.subjectId;
        if (st === 'Worklog' && sid) {
          try { doc = await apiJson<any>(`/api/worklogs/${encodeURIComponent(sid)}`); } catch {}
        } else if (st === 'CAR_DISPATCH' && sid) {
          try { doc = await apiJson<any>(`/api/car-dispatch/${encodeURIComponent(sid)}`); } catch {}
        } else if (st === 'ATTENDANCE' && sid) {
          try { doc = await apiJson<any>(`/api/attendance/${encodeURIComponent(sid)}`); } catch {}
        } else if (st === 'PROCESS' && sid) {
          try {
            const inst = await apiJson<any>(`/api/processes/${encodeURIComponent(sid)}`);
            const sum = await apiJson<any>(`/api/processes/${encodeURIComponent(sid)}/approval-summary`);
            doc = { process: inst, summaryHtml: sum?.html || '' };
          } catch {}
        }
        return { ...a, _doc: doc };
      }));
      setItems(enriched);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  async function approve(requestId: string, cmt?: string) {
    await apiJson(`/api/approvals/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment: cmt || undefined }) });
    await load();
  }

  async function reject(requestId: string, cmt?: string) {
    const bodyComment = typeof cmt === 'string' ? cmt : (window.prompt('반려 사유를 입력하세요') || '');
    await apiJson(`/api/approvals/${requestId}/reject`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment: bodyComment }) });
    await load();
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
          const st = a.subjectType;
          let title = '문서 정보 없음';
          let meta = '';
          let when = a.createdAt as string | undefined;

          if (st === 'CAR_DISPATCH' && doc) {
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
          } else if (st === 'ATTENDANCE' && doc) {
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
          } else if (st === 'Worklog' && doc) {
            const wl = doc;
            title = ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)');
            meta = `${wl.userName || ''}${wl.teamName ? ` · ${wl.teamName}` : ''}`;
            when = wl?.date || wl?.createdAt || when;
          } else if (st === 'PROCESS' && doc) {
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
          return (
            <div key={a.id} style={card} onClick={() => setActive(a)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <b>{title}</b>
                <span style={chip}>{statusLabel(a.status)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
              </div>
              <div style={{ fontSize: 12, color: '#334155' }}>{meta}</div>
              {st === 'Worklog' && doc && (
                doc.attachments?.contentHtml ? (
                  <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginTop: 6 }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(doc.attachments.contentHtml) }} />
                ) : (
                  <div style={{ color: '#334155', marginTop: 6 }}>{String(doc.note || '').split('\n').slice(1).join('\n')}</div>
                )
              )}
              {st === 'PROCESS' && doc?.summaryHtml ? (
                <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginTop: 6 }} dangerouslySetInnerHTML={{ __html: doc.summaryHtml }} />
              ) : null}
              {st === 'Worklog' && doc?.attachments?.files?.length ? (
                <div className="attachments" style={{ marginTop: 8 }}>
                  {doc.attachments.files.map((f: any, i: number) => {
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
              {a.status === 'PENDING' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={(e) => { e.stopPropagation(); approve(a.id); }} style={primaryBtn}>승인</button>
                  <button onClick={(e) => { e.stopPropagation(); reject(a.id); }} style={ghostBtn}>반려</button>
                </div>
              )}
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
              const st = n.subjectType;
              let title = '문서 정보 없음';
              let meta = '';
              let when = n.createdAt as string | undefined;

              if (st === 'CAR_DISPATCH' && doc) {
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
              } else if (st === 'ATTENDANCE' && doc) {
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
              } else if (st === 'Worklog' && doc) {
                const wl = doc;
                title = ((wl.note || '').split('\n')[0] || wl.title || '(제목 없음)');
                meta = `${wl.userName || ''}${wl.teamName ? ` · ${wl.teamName}` : ''}`;
                when = wl?.date || wl?.createdAt || when;
              } else if (st === 'PROCESS' && doc) {
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
              return (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>{title}</b>
                    <span style={chip}>{statusLabel(n.status)}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
                  </div>
                  {meta && <div style={{ fontSize: 12, color: '#334155' }}>{meta}</div>}
                  {st === 'Worklog' && doc && (
                    doc.attachments?.contentHtml ? (
                      <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginTop: 6, maxHeight: 360, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: absolutizeUploads(doc.attachments.contentHtml) }} />
                    ) : (
                      <div style={{ color: '#334155', marginTop: 6, whiteSpace: 'pre-wrap' }}>{String(doc.note || '').split('\n').slice(1).join('\n')}</div>
                    )
                  )}
                  {st === 'PROCESS' && doc?.summaryHtml ? (
                    <div className="rich-content" style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginTop: 6, maxHeight: 360, overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: doc.summaryHtml }} />
                  ) : null}
                  {st === 'Worklog' && doc?.attachments?.files?.length ? (
                    <div className="attachments" style={{ marginTop: 8 }}>
                      {doc.attachments.files.map((f: any, i: number) => {
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
                      {n.status === 'PENDING' && (
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
