import { useEffect, useRef, useState } from 'react';
import { LoadingButton } from '../components/LoadingButton';
import { apiJson, apiUrl } from '../lib/api';
import { WorklogDocument } from '../components/WorklogDocument';
import { ProcessDocument } from '../components/ProcessDocument';
import { UserAvatar } from '../components/UserAvatar';
import { ApprovalStepLadder, turnBadge, type ApprovalStep } from '../components/ApprovalSteps';

const PAGE_SIZE = 20;

export function ApprovalsInbox() {
  const [userId, setUserId] = useState<string>('');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<any | null>(null);
  const [comment, setComment] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'APPROVAL' | 'REQUEST'>('ALL');
  const [subjectTypeFilter, setSubjectTypeFilter] = useState<'ALL' | 'ATTENDANCE' | 'BUSINESS_TRIP' | 'CAR_DISPATCH' | 'LOGISTICS_DISPATCH'>('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [worklogPopup, setWorklogPopup] = useState<{ id: string; title: string; contentHtml: string; note: string; files?: any[]; createdAt: string; createdBy?: { name: string } } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [nameInput, setNameInput] = useState('');   // 신청자 이름 입력(즉시)
  const [nameQuery, setNameQuery] = useState('');    // 신청자 이름(디바운스 적용)
  const [titleInput, setTitleInput] = useState('');  // 제목 검색 입력(즉시)
  const [titleQuery, setTitleQuery] = useState('');  // 제목 검색(디바운스 적용)
  const [memberNames, setMemberNames] = useState<string[]>([]); // 드롭다운용 구성원 이름 목록
  const loadSeq = useRef(0); // 최신 로드만 반영(오래된 응답 무시)

  useEffect(() => {
    const uid = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
    if (uid) setUserId(uid);
  }, []);

  // 구성원 이름 목록(드롭다운/자동완성용) 로드
  useEffect(() => {
    let alive = true;
    apiJson<{ items: Array<{ name?: string }> }>('/api/users')
      .then((res) => {
        if (!alive) return;
        const names = Array.from(new Set((res.items || []).map((u) => String(u.name || '').trim()).filter(Boolean)))
          .sort((a, b) => a.localeCompare(b, 'ko'));
        setMemberNames(names);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // 이름 입력 디바운스 (300ms)
  useEffect(() => {
    const t = setTimeout(() => setNameQuery(nameInput.trim()), 300);
    return () => clearTimeout(t);
  }, [nameInput]);

  // 제목 검색 디바운스 (400ms — 서버가 문서 테이블 전체를 검색하므로 약간 여유)
  useEffect(() => {
    const t = setTimeout(() => setTitleQuery(titleInput.trim()), 400);
    return () => clearTimeout(t);
  }, [titleInput]);

  useEffect(() => {
    if (userId) void load();
  }, [userId, statusFilter, subjectTypeFilter, typeFilter, nameQuery, titleQuery, page]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter, subjectTypeFilter, typeFilter, nameQuery, titleQuery]);

  async function load() {
    if (!userId) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('approverId', userId);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (subjectTypeFilter !== 'ALL') params.set('subjectType', subjectTypeFilter);
      else if (typeFilter !== 'ALL') params.set('subjectGroup', typeFilter); // 일반결재/신청 그룹 — 서버 필터(페이징 정확)
      // PENDING 필터일 때는 자신의 차례인 것만 보여줌
      if (statusFilter === 'PENDING') params.set('currentApproverOnly', '1');
      if (nameQuery) params.set('requesterName', nameQuery); // 신청자(구성원) 이름 필터
      if (titleQuery) params.set('titleQuery', titleQuery); // 문서 제목 검색 (서버가 대상 문서 검색)
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String((page - 1) * PAGE_SIZE));
      params.set('withTotal', '1');
      const res = await apiJson<{ items: any[]; total?: number }>(`/api/approvals?${params.toString()}`);
      if (seq !== loadSeq.current) return; // 더 최신 로드가 진행 중이면 무시
      setTotal(res.total ?? res.items?.length ?? 0);
      const base = (res.items || []).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      // 1) 목록을 먼저 즉시 표시(문서 상세 없이). 상세는 아래에서 백그라운드로 채운다.
      setItems(base.map((a: any) => ({ ...a, _doc: null, _stNorm: String(a.subjectType || '').toUpperCase() })));
      setLoading(false);
      // 2) 문서 상세(신청 내용)는 배치 조회 후 병합 — 목록 렌더를 막지 않는다.
      if (base.length) {
        void (async () => {
          try {
            const batchItems = base.map((a: any) => ({ subjectType: String(a.subjectType || ''), subjectId: String(a.subjectId || '') }));
            const batchRes = await apiJson<{ results: Record<string, any> }>(`/api/approvals/batch-subjects`, {
              method: 'POST',
              body: JSON.stringify({ items: batchItems }),
            });
            if (seq !== loadSeq.current) return; // stale
            const docMap = batchRes.results || {};
            setItems((prev) => prev.map((a: any) => {
              const stNorm = String(a.subjectType || '').toUpperCase();
              const key = `${a.subjectType}::${a.subjectId}`;
              const doc = docMap[key] ?? null;
              const finalDoc = stNorm === 'PROCESS' && doc ? { process: doc, summaryTasks: [], pendingTask: null } : doc;
              return { ...a, _doc: finalDoc, _stNorm: stNorm };
            }));
          } catch {}
        })();
      }
    } catch (e: any) {
      if (seq !== loadSeq.current) return;
      setError(e?.message || '로드 실패');
      setLoading(false);
    }
  }

  function markItem(requestId: string, status: 'APPROVED' | 'REJECTED') {
    // PENDING(내 차례) 인박스에서는 처리한 건을 즉시 목록에서 제거하고 총건수 감소.
    // (그대로 두면 이미 승인한 건이 남아 "리로드하면 또 있다"처럼 보이고 페이징이 어긋남)
    if (statusFilter === 'PENDING') {
      setItems((prev) => {
        const next = prev.filter((a) => a.id !== requestId);
        if (next.length === 0) setTimeout(() => { void load(); }, 0); // 페이지가 비면 다음 페이지 로드
        return next;
      });
      setTotal((t) => Math.max(0, t - 1));
      setActive((prev: any) => prev?.id === requestId ? null : prev);
    } else {
      setItems((prev) => prev.map((a) => a.id === requestId ? { ...a, status } : a));
      setActive((prev: any) => prev?.id === requestId ? { ...prev, status } : prev);
    }
  }

  async function approve(requestId: string, cmt?: string) {
    setActionLoading(requestId + ':approve');
    setError(null);
    try {
      await apiJson(`/api/approvals/${requestId}/approve`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment: cmt || undefined }) });
      markItem(requestId, 'APPROVED');
    } catch (e: any) {
      const msg = e?.message || '승인 처리에 실패했습니다.';
      setError(msg);
      try { window.alert(`승인 실패: ${msg}`); } catch {}
    } finally {
      setActionLoading(null);
    }
  }

  async function reject(requestId: string, cmt?: string) {
    const bodyComment = typeof cmt === 'string' ? cmt : (window.prompt('반려 사유를 입력하세요') || '');
    setActionLoading(requestId + ':reject');
    setError(null);
    try {
      await apiJson(`/api/approvals/${requestId}/reject`, { method: 'POST', body: JSON.stringify({ actorId: userId, comment: bodyComment }) });
      markItem(requestId, 'REJECTED');
    } catch (e: any) {
      const msg = e?.message || '반려 처리에 실패했습니다.';
      setError(msg);
      try { window.alert(`반려 실패: ${msg}`); } catch {}
    } finally {
      setActionLoading(null);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#475569' }}>상태</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={input}>
            <option value="PENDING">미승인</option>
            <option value="APPROVED">승인</option>
            <option value="REJECTED">반려</option>
            <option value="ALL">전체</option>
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
          <label style={{ fontSize: 12, color: '#475569' }}>구성원</label>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="신청자 검색/선택"
            list="approval-member-names"
            style={{ ...input, width: 140 }}
          />
          <datalist id="approval-member-names">
            {memberNames.map((n) => (<option key={n} value={n} />))}
          </datalist>
          {nameInput && (
            <button
              type="button"
              onClick={() => setNameInput('')}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}
              title="지우기"
            >✕</button>
          )}
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
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((a) => {
          const doc = (a as any)._doc as any | null;
          const stNorm = String((a as any)._stNorm || a.subjectType || '').toUpperCase();
          let title = '문서 정보 없음';
          let meta = '';
          let when = a.createdAt as string | undefined;

          if (stNorm === 'CAR_DISPATCH' && doc) {
            const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '';
            const fmtTime = (iso: string) => iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            const dateStr = doc.startAt ? fmtDate(doc.startAt) : '';
            const timeStr = doc.startAt && doc.endAt ? `${fmtTime(doc.startAt)}~${fmtTime(doc.endAt)}` : '';
            const carInfo = [doc.car?.name || doc.carName, doc.car?.type].filter(Boolean).join(' ');
            title = `[배차] ${carInfo} | ${dateStr} ${timeStr} | ${doc.destination || ''}`.trim();
            const parts = [
              doc.requester?.name || doc.requesterName || '',
              doc.purpose || '',
              doc.coRiders ? `동승자: ${doc.coRiders}` : '',
            ].filter(Boolean);
            meta = parts.join(' · ');
            when = doc.createdAt || doc.startAt || when;
          } else if (stNorm === 'ATTENDANCE' && doc) {
            let kind: string;
            if (doc.type === 'OT') kind = 'OT';
            else if (doc.type === 'VACATION') kind = '휴가';
            else if (doc.type === 'PARENTAL_LEAVE') kind = '육아휴직';
            else if (doc.type === 'PUBLIC_DUTY') kind = '공가';
            else if (doc.type === 'EARLY_LEAVE') kind = '조퇴';
            else if (doc.type === 'FLEXIBLE') kind = '유연근무';
            else if (doc.type === 'HOLIDAY_WORK' || doc.type === 'HOLIDAY_REST') kind = '휴일대체';
            else kind = doc.type;

            const fmtMd = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
            const dateShort = doc.date ? fmtMd(doc.date) : '';
            // 기간 신청(endDate)이면 시작~종료로 표시
            const periodStr = doc.endDate ? `${dateShort}~${fmtMd(doc.endDate)}` : dateShort;
            const timeRange = doc.startAt && doc.endAt
              ? `${new Date(doc.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}~${new Date(doc.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`
              : (doc.type === 'VACATION' || doc.type === 'PARENTAL_LEAVE' || doc.type === 'PUBLIC_DUTY' || doc.type === 'HOLIDAY_REST' ? (doc.endDate ? '' : '종일') : '');
            const otMins = doc.type === 'OT' && doc.startAt && doc.endAt
              ? Math.round((new Date(doc.endAt).getTime() - new Date(doc.startAt).getTime()) / 60000)
              : 0;
            const durationStr = otMins > 0 ? `${otMins >= 60 ? `${Math.floor(otMins / 60)}h${otMins % 60 ? `${otMins % 60}m` : ''}` : `${otMins}m`}` : '';
            title = `[${kind}] ${periodStr} ${timeRange}${durationStr ? ` (${durationStr})` : ''}`.trim();
            const parts = [
              doc.user?.name || doc.requesterName || '',
              doc.reason || '',
            ].filter(Boolean);
            meta = parts.join(' · ');
            when = doc.createdAt || doc.date || when;
          } else if (stNorm === 'LOGISTICS_DISPATCH' && doc) {
            const fmtDt = (iso: string) => iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            title = `[물류배차] ${doc.vehicleType || ''} | ${doc.loadingPlace || ''} → ${doc.unloadingPlace || ''}`.trim();
            const parts = [
              doc.requester?.name || doc.requesterName || '',
              doc.loadingAt ? `상차: ${fmtDt(doc.loadingAt)}` : '',
              doc.unloadingAt ? `하차: ${fmtDt(doc.unloadingAt)}` : '',
              doc.cargoDetails ? `화물: ${doc.cargoDetails}` : '',
            ].filter(Boolean);
            meta = parts.join(' · ');
            when = doc.createdAt || when;
          } else if (stNorm === 'BUSINESS_TRIP' && doc) {
            const fmtDt = (iso: string) => iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
            const dateRange = doc.departureAt && doc.returnAt
              ? `${fmtDt(doc.departureAt)} ~ ${fmtDt(doc.returnAt)}`
              : (doc.departureAt ? fmtDt(doc.departureAt) : '');
            title = `[출장] ${doc.destination || ''} | ${dateRange}`.trim();
            const parts = [
              doc.requester?.name || doc.requesterName || '',
              doc.purpose || '',
              doc.transportation || '',
              doc.accommodation ? '숙박 필요' : '',
            ].filter(Boolean);
            meta = parts.join(' · ');
            when = doc.createdAt || when;
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
                    <LoadingButton loading={actionLoading === a.id + ':approve'} disabled={actionLoading != null} onClick={(e) => { e.stopPropagation(); approve(a.id); }} style={compactPrimaryBtn}>승인</LoadingButton>
                    <LoadingButton loading={actionLoading === a.id + ':reject'} disabled={actionLoading != null} onClick={(e) => { e.stopPropagation(); reject(a.id); }} style={compactGhostBtn}>반려</LoadingButton>
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
      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...paginationBtn, opacity: page <= 1 ? 0.5 : 1 }}
          >
            ← 이전
          </button>
          <span style={{ fontSize: 13, color: '#475569' }}>
            {page} / {Math.ceil(total / PAGE_SIZE)} 페이지 (총 {total}건)
          </span>
          <button
            onClick={() => setPage(p => Math.min(Math.ceil(total / PAGE_SIZE), p + 1))}
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            style={{ ...paginationBtn, opacity: page >= Math.ceil(total / PAGE_SIZE) ? 0.5 : 1 }}
          >
            다음 →
          </button>
        </div>
      )}
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
                const carLabel = [doc.car?.name || doc.carName, doc.car?.type].filter(Boolean).join(' ');
                title = `배차 신청${carLabel ? ` - ${carLabel}` : ''}`.trim();
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
                else if (doc.type === 'PARENTAL_LEAVE') kind = '육아휴직';
                else if (doc.type === 'PUBLIC_DUTY') kind = '공가';
                else if (doc.type === 'EARLY_LEAVE') kind = '조퇴';
                else if (doc.type === 'FLEXIBLE') kind = '유연근무';
                else if (doc.type === 'HOLIDAY_WORK' || doc.type === 'HOLIDAY_REST') kind = '휴일 대체 신청';
                else kind = doc.type;

                const fmtMd = (iso: string) => new Date(iso).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
                const dateShort = doc.date ? fmtMd(doc.date) : '';
                // 기간 신청(endDate)이면 시작~종료로 표시
                const periodShort = doc.endDate ? `${dateShort} ~ ${fmtMd(doc.endDate)}` : dateShort;
                const otMins = doc.type === 'OT' && doc.startAt && doc.endAt
                  ? Math.round((new Date(doc.endAt).getTime() - new Date(doc.startAt).getTime()) / 60000)
                  : 0;
                const otStr = otMins > 0 ? ` | ${otMins >= 60 ? `${Math.floor(otMins / 60)}시간${otMins % 60 ? ` ${otMins % 60}분` : ''}` : `${otMins}분`}` : '';
                title = `근태 신청 - ${kind}${periodShort ? ` | ${periodShort}` : ''}${otStr}`.trim();
                const timeRange = doc.startAt && doc.endAt
                  ? `${new Date(doc.startAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })} ~ ${new Date(doc.endAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}`
                  : (doc.type === 'VACATION' || doc.type === 'PARENTAL_LEAVE' || doc.type === 'PUBLIC_DUTY' || doc.type === 'HOLIDAY_REST' ? (doc.endDate ? '기간 휴무' : '종일') : '');
                const parts = [
                  doc.requesterName || '',
                  timeRange,
                  doc.reason || '',
                ].filter(Boolean);
                meta = parts.join(' · ');
                when = doc.createdAt || doc.date || when;
              } else if (stNorm === 'LOGISTICS_DISPATCH' && doc) {
                const fmtDt = (iso: string) => iso ? new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
                title = `물류 배차 신청 — ${doc.vehicleType || ''}`.trim();
                const parts = [
                  doc.requester?.name || doc.requesterName || '',
                  doc.loadingPlace ? `상차: ${doc.loadingPlace} ${fmtDt(doc.loadingAt)}` : '',
                  doc.unloadingPlace ? `하차: ${doc.unloadingPlace} ${fmtDt(doc.unloadingAt)}` : '',
                  doc.cargoDetails ? `화물: ${doc.cargoDetails}` : '',
                ].filter(Boolean);
                meta = parts.join(' · ');
                when = doc.createdAt || when;
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
                  {stNorm === 'ATTENDANCE' && doc?.attachments && Array.isArray(doc.attachments) && doc.attachments.length > 0 && (
                    <div style={{ marginTop: 8, background: '#F8FAFC', borderRadius: 8, padding: 10, border: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>첨부 파일</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {doc.attachments.map((att: any, idx: number) => {
                          const url = pickFileUrl(att);
                          const name = pickFileName(att, url);
                          const isImg = isImageAttachment(att, url);
                          return (
                            <a
                              key={idx}
                              href={absLink(url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 6, padding: '6px 10px', textDecoration: 'none', color: '#0F3D73', fontSize: 12 }}
                            >
                              {isImg && (
                                <img
                                  src={absLink(url)}
                                  alt={name}
                                  style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }}
                                />
                              )}
                              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                            </a>
                          );
                        })}
                      </div>
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
                          <LoadingButton
                            loading={actionLoading === active.id + ':approve'}
                            disabled={actionLoading != null}
                            onClick={async () => {
                              await approve(active.id, comment);
                              setComment('');
                              setActive(null);
                            }}
                            style={primaryBtn}
                          >
                            승인
                          </LoadingButton>
                          <LoadingButton
                            loading={actionLoading === active.id + ':reject'}
                            disabled={actionLoading != null}
                            onClick={async () => {
                              await reject(active.id, comment || undefined);
                              setComment('');
                              setActive(null);
                            }}
                            style={ghostBtn}
                          >
                            반려
                          </LoadingButton>
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

const paginationBtn: React.CSSProperties = {
  background: '#FFFFFF',
  color: '#0F3D73',
  border: '1px solid #CBD5E1',
  borderRadius: 8,
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
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
