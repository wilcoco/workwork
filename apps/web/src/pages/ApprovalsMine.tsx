import { useEffect, useState } from 'react';
import { apiJson, apiUrl } from '../lib/api';
import { WorklogDocument } from '../components/WorklogDocument';
import { ProcessDocument } from '../components/ProcessDocument';
import { UserAvatar } from '../components/UserAvatar';

export function ApprovalsMine() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'APPROVAL' | 'REQUEST'>('ALL');
  const [subjectTypeFilter, setSubjectTypeFilter] = useState<'ALL' | 'ATTENDANCE' | 'BUSINESS_TRIP' | 'CAR_DISPATCH' | 'LOGISTICS_DISPATCH'>('ALL');
  const [titleInput, setTitleInput] = useState('');
  const [titleQuery, setTitleQuery] = useState('');

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
    if (uid) setUserId(uid);
  }, []);

  useEffect(() => {
    const h = setTimeout(() => setTitleQuery(titleInput.trim()), 400);
    return () => clearTimeout(h);
  }, [titleInput]);

  useEffect(() => {
    if (userId) void load(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, statusFilter, subjectTypeFilter, titleQuery]);

  async function load(reqUserId?: string) {
    const uid = reqUserId || userId;
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('requestedById', uid);
      params.set('limit', '50');
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (subjectTypeFilter !== 'ALL') params.set('subjectType', subjectTypeFilter);
      if (titleQuery) params.set('titleQuery', titleQuery); // 문서 제목 검색 (서버가 대상 문서 검색)
      const list = await apiJson<{ items: any[] }>(`/api/approvals?${params.toString()}`);
      const baseItems = (list.items || []).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      // enrich subjects
      const enriched = await Promise.all(baseItems.map(async (a: any) => {
        let docTitle: string | undefined;
        let docDate: string | undefined;
        let doc: any = null;
        if (a.subjectType === 'Worklog' && a.subjectId) {
          try {
            const _vid = localStorage.getItem('userId') || ''; const wl = await apiJson<any>(`/api/worklogs/${encodeURIComponent(a.subjectId)}${_vid ? `?viewerId=${encodeURIComponent(_vid)}` : ''}`);
            doc = wl;
            const note: string = wl?.note || '';
            const first = (note || '').split(/\n+/)[0] || '';
            docTitle = first || '(제목 없음)';
            if (wl?.date) docDate = wl.date;
          } catch {}
        } else if (a.subjectType === 'PROCESS' && a.subjectId) {
          try {
            const inst = await apiJson<any>(`/api/processes/${encodeURIComponent(a.subjectId)}`);
            const sum = await apiJson<any>(`/api/processes/${encodeURIComponent(a.subjectId)}/approval-summary`);
            doc = { process: inst, summaryTasks: sum?.tasks || [], pendingTask: sum?.pendingTask || null };
            docTitle = `프로세스 결재 - ${(inst?.title || '').trim()}`;
            docDate = inst?.createdAt || a.createdAt;
          } catch {}
        }
        return { ...a, docTitle, docDate, _doc: doc };
      }));
      setItems(enriched);
    } catch (e: any) {
      setError(e?.message || '로드 실패');
    } finally {
      setLoading(false);
    }
  }

  // 인쇄/PDF 저장: 인쇄 CSS(.approval-print-area)로 모달 내용만 출력 — 브라우저 "PDF로 저장" 지원
  function printActive() {
    document.body.classList.add('printing-approval');
    const cleanup = () => {
      document.body.classList.remove('printing-approval');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 3000); // afterprint 미지원 브라우저 대비
  }

  const filteredItems = items.filter((a) => {
    if (typeFilter === 'ALL') return true;
    const st = String(a.subjectType || '').toUpperCase();
    const requestTypes = ['CAR_DISPATCH', 'LOGISTICS_DISPATCH', 'ATTENDANCE', 'BUSINESS_TRIP'];
    const isRequest = requestTypes.includes(st);
    return typeFilter === 'REQUEST' ? isRequest : !isRequest;
  });

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#475569' }}>상태</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={input}>
            <option value="ALL">전체</option>
            <option value="PENDING">미승인</option>
            <option value="APPROVED">승인</option>
            <option value="REJECTED">반려</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#475569' }}>유형</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} style={input}>
            <option value="ALL">전체</option>
            <option value="APPROVAL">일반 결재</option>
            <option value="REQUEST">신청</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#475569' }}>신청 종류</label>
          <select value={subjectTypeFilter} onChange={(e) => setSubjectTypeFilter(e.target.value as any)} style={input}>
            <option value="ALL">전체</option>
            <option value="ATTENDANCE">근태</option>
            <option value="BUSINESS_TRIP">출장</option>
            <option value="CAR_DISPATCH">차량 배차</option>
            <option value="LOGISTICS_DISPATCH">물류 배차</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#475569' }}>제목</label>
          <input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="제목/내용 검색"
            style={{ ...input, width: 160 }}
          />
          {titleInput && (
            <button
              type="button"
              onClick={() => setTitleInput('')}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}
              title="지우기"
            >✕</button>
          )}
        </div>
        {loading && <span style={{ fontSize: 12, color: '#64748b' }}>로딩중...</span>}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {filteredItems.map((it) => {
          const requestedByName = String(it.requestedBy?.name || '-');
          const requestedById = String(it.requestedBy?.id || '');
          const currentApproverName = String(it.currentApprover?.name || '');
          const currentApproverId = String(it.currentApprover?.id || '');
          const meta = (
            <span>
              작성자: {requestedByName} <UserAvatar userId={requestedById} name={requestedByName} size={14} style={{ marginLeft: 4 }} />
              {currentApproverName ? (
                <>
                  {' '}· 현재 결재자: {currentApproverName} <UserAvatar userId={currentApproverId} name={currentApproverName} size={14} style={{ marginLeft: 4 }} />
                </>
              ) : null}
            </span>
          );
          const steps: any[] = Array.isArray(it.steps) ? it.steps : [];
          const stepSummary = (() => {
            if (!steps.length) return '';
            const label = (s: any) => {
              if (s.status === 'APPROVED') return '승인 완료';
              if (s.status === 'REJECTED') return '반려';
              if (s.status === 'EXPIRED') return '만료';
              return '승인 대기';
            };
            const parts = steps.map((s) => {
              const name = s.approver?.name || '결재자';
              return `${s.stepNo}단계: ${name} – ${label(s)}`;
            });
            return `결재선: ${parts.join(', ')}`;
          })();
          return (
            <div key={it.id} style={compactCard} onClick={() => setActive(it)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
                <span style={chip}>{statusLabel(it.status)}</span>
                {requestedById && <UserAvatar userId={requestedById} name={requestedByName} size={22} />}
                {requestedByName && requestedByName !== '-' && <span style={{ fontSize: 13, color: '#334155', fontWeight: 600, flexShrink: 0 }}>{requestedByName}</span>}
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.docTitle || '문서 정보 없음'}</span>
                {currentApproverName && <span style={{ fontSize: 12, color: '#64748b', flexShrink: 0 }}>현재 결재자: {currentApproverName}</span>}
                <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>신청 {new Date(it.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          );
        })}
        {!filteredItems.length && <div style={{ color: '#64748b' }}>표시할 결재 내역이 없습니다</div>}
      </div>
      {active && (
        <div style={modalOverlay} onClick={() => setActive(null)}>
          <div style={modalBody} className="approval-print-area" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const it = active;
              const wl = it._doc as any | null;
              const title = it.docTitle || (wl?.title || '문서 정보 없음');
              const when = it.docDate || it.createdAt;
              const requestedByName = String(it.requestedBy?.name || '-');
              const requestedById = String(it.requestedBy?.id || '');
              const teamName = String(wl?.teamName || '');
              const steps: any[] = Array.isArray(it.steps) ? it.steps : [];
              const fmtDT = (d?: string | null) => (d ? new Date(d).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
              const stepColor = (s: string) => (s === 'APPROVED' ? '#16a34a' : s === 'REJECTED' ? '#dc2626' : '#d97706');
              const stepLabel = (s: string) => (s === 'APPROVED' ? '승인' : s === 'REJECTED' ? '반려' : s === 'EXPIRED' ? '만료' : '대기');
              const meta = (
                <span>
                  작성자: {requestedByName} <UserAvatar userId={requestedById} name={requestedByName} size={14} style={{ marginLeft: 4 }} />
                  {teamName ? ` · ${teamName}` : ''}
                </span>
              );
              return (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>{title}</b>
                    <span style={chip}>{statusLabel(it.status)}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: '#64748b' }}>{when ? new Date(when).toLocaleString() : ''}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#334155' }}>{meta}</div>
                  {/* 결재선 · 진행 현황 (처리 시각 포함) — 인쇄물에도 포함된다 */}
                  {steps.length > 0 && (
                    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>결재선 · 진행 현황</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr>
                            {['단계', '결재자', '상태', '처리 일시', '의견'].map((h) => (
                              <th key={h} style={{ textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #e2e8f0', color: '#475569', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {steps.map((s: any) => (
                            <tr key={s.id || s.stepNo}>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9' }}>{s.stepNo}</td>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{s.approver?.name || '-'}</td>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', color: stepColor(String(s.status)), fontWeight: 700 }}>{stepLabel(String(s.status))}</td>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>{fmtDT(s.actedAt) || '—'}</td>
                              <td style={{ padding: '4px 8px', borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>{s.comment || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {it.subjectType === 'Worklog' && wl && (
                    <div className="print-expand" style={{ marginTop: 6, maxHeight: 520, overflow: 'auto' }}>
                      <WorklogDocument worklog={wl} variant="full" />
                    </div>
                  )}
                  {it.subjectType === 'PROCESS' && it._doc ? (
                    <div className="print-expand" style={{ marginTop: 8, maxHeight: 520, overflow: 'auto' }}>
                      <ProcessDocument processDoc={it._doc} variant="full" />
                    </div>
                  ) : null}
                  <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <button type="button" style={{ ...primaryBtn, background: '#fff', color: '#0F3D73', border: '1px solid #0F3D73' }} onClick={printActive}>
                      🖨 인쇄 / PDF 저장
                    </button>
                    <button type="button" style={primaryBtn} onClick={() => setActive(null)}>닫기</button>
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

const chip: React.CSSProperties = {
  background: '#E6EEF7',
  color: '#0F3D73',
  border: '1px solid #0F3D73',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 12,
  fontWeight: 700,
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

function statusLabel(s?: string): string {
  if (s === 'APPROVED') return '승인';
  if (s === 'REJECTED') return '반려';
  if (s === 'EXPIRED') return '만료';
  return '미승인';
}
