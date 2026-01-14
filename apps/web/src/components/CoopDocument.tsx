import { useMemo } from 'react';
import { formatKstDatetime } from '../lib/time';
import { WorklogDocument } from './WorklogDocument';

type Variant = 'full' | 'compact' | 'content';

export function CoopDocument({ ticket, requestWorklog, responseWorklog, variant }: { ticket: any; requestWorklog?: any | null; responseWorklog?: any | null; variant?: Variant }) {
  const v: Variant = variant || 'full';

  const title = useMemo(() => {
    const helpTitle = String(ticket?.helpTitle || '').trim();
    if (helpTitle) return helpTitle;
    const category = String(ticket?.category || '').trim();
    if (category) return `업무 요청: ${category}`;
    return '업무 요청';
  }, [ticket]);

  const requesterName = ticket?.requester?.name || ticket?.requesterName || '';
  const assigneeName = ticket?.assignee?.name || ticket?.assigneeName || '';
  const statusLabel = ticket?.statusLabel || ticket?.status || '';
  const dueAt = ticket?.dueAt || null;
  const createdAt = ticket?.createdAt || null;

  const showHeader = v !== 'content';
  const showResponse = v === 'full';
  const showWorklogBody = v === 'full';

  const wlTitle = (wl: any) => {
    const t = String(wl?.title || '').trim();
    if (t) return t;
    const n = String(wl?.note || '').trim();
    return (n.split(/\n+/)[0] || '').trim() || '업무일지';
  };

  const wlMeta = (wl: any) => {
    const who = wl?.createdBy?.name || wl?.userName || '';
    const team = wl?.createdBy?.orgUnit?.name || wl?.teamName || '';
    const whenWl = wl?.date || wl?.createdAt || '';
    const parts = [who && `작성자: ${who}`, team && `팀: ${team}`, whenWl && `작성: ${formatKstDatetime(whenWl)}`].filter(Boolean);
    return parts.join(' · ');
  };

  const requestTitleText = requestWorklog
    ? wlTitle(requestWorklog)
    : (String(ticket?.requestWorklogTitle || ticket?.helpTitle || '').trim() || '(제목 없음)');
  const requestMetaText = requestWorklog
    ? wlMeta(requestWorklog)
    : (createdAt ? `요청 생성: ${formatKstDatetime(createdAt)}` : '');

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {showHeader && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800, fontSize: v === 'compact' ? 16 : 18, color: '#0f172a' }}>{title}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: '#475569', fontSize: 12 }}>
            {statusLabel ? <span style={{ background: '#F1F5F9', color: '#334155', padding: '2px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #CBD5E1' }}>상태: {statusLabel}</span> : null}
            {requesterName ? <span style={{ background: '#E6EEF7', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>요청자: {requesterName}</span> : null}
            {assigneeName ? <span style={{ background: '#F8FAFC', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontWeight: 600, border: '1px solid #E2E8F0' }}>담당자: {assigneeName}</span> : null}
            {dueAt ? <span style={{ background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 999, fontWeight: 700, border: '1px solid #FDE68A' }}>기한: {formatKstDatetime(dueAt)}</span> : null}
            {createdAt ? <span style={{ marginLeft: 'auto', color: '#64748b' }}>{formatKstDatetime(createdAt)}</span> : null}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E5E7EB' }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>요청 업무일지</div>
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ fontWeight: 800, color: '#0f172a' }}>{requestTitleText}</div>
          {requestMetaText ? <div style={{ fontSize: 12, color: '#64748b' }}>{requestMetaText}</div> : null}
          {showWorklogBody ? (
            requestWorklog ? (
              <WorklogDocument worklog={requestWorklog} variant="content" />
            ) : (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>요청 업무일지 전문을 불러오지 못했습니다.</div>
            )
          ) : null}
        </div>
      </div>

      {showResponse && (
        <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E5E7EB' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>응답 업무일지</div>
          {responseWorklog ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 800, color: '#0f172a' }}>{wlTitle(responseWorklog)}</div>
              {wlMeta(responseWorklog) ? <div style={{ fontSize: 12, color: '#64748b' }}>{wlMeta(responseWorklog)}</div> : null}
              <WorklogDocument worklog={responseWorklog} variant="content" />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>응답 업무일지가 아직 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}
