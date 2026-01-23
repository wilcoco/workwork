import { useMemo, useState, type MouseEvent } from 'react';
import { apiUrl } from '../lib/api';
import { toSafeHtml } from '../lib/richText';
import { formatKstDatetime, formatKstYmd, formatMinutesAsHmKo } from '../lib/time';

const VISIBILITY_LABEL: Record<string, string> = {
  ALL: '전체',
  MANAGER_PLUS: '팀장이상',
  EXEC_PLUS: '임원이상',
  CEO_ONLY: '대표이사',
};

function visibilityKo(v: any): string {
  const key = String(v || 'ALL');
  return VISIBILITY_LABEL[key] || key;
}

export function WorklogDocument({ worklog, variant }: { worklog: any; variant?: 'full' | 'compact' | 'content' }) {
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

  const title = useMemo(() => {
    const raw = String(worklog?.title || '').trim();
    if (raw) return raw;
    const lines = String(worklog?.note || '').split(/\n+/);
    return (lines[0] || '').trim();
  }, [worklog]);

  const bodyText = useMemo(() => {
    const note = String(worklog?.note || '');
    const lines = note.split(/\n+/);
    return lines.slice(1).join('\n').trim();
  }, [worklog]);

  const contentHtml = useMemo(() => {
    const a = String(worklog?.attachments?.contentHtml || '').trim();
    if (a) return a;
    const c = String(worklog?.contentHtml || '').trim();
    if (c) return c;
    const note = String(worklog?.note || '').trim();
    if (note && /<\/?[a-z][\s\S]*>/i.test(note)) return note;
    return '';
  }, [worklog]);
  const files = useMemo(() => {
    if (Array.isArray(worklog?.attachments?.files)) return worklog.attachments.files;
    if (Array.isArray(worklog?.files)) return worklog.files;
    return [];
  }, [worklog]);

  const photos = useMemo(() => {
    if (Array.isArray(worklog?.attachments?.photos)) return worklog.attachments.photos;
    return [];
  }, [worklog]);

  const createdAt = worklog?.createdAt;
  const workDate = worklog?.date;
  const who = worklog?.createdBy?.name || worklog?.userName || worklog?.createdById || '';
  const team = worklog?.createdBy?.orgUnit?.name || worklog?.teamName || '';

  const objectiveTitle = worklog?.initiative?.keyResult?.objective?.title || '';
  const keyResultTitle = worklog?.initiative?.keyResult?.title || '';
  const initiativeTitle = worklog?.initiative?.title || worklog?.initiativeTitle || worklog?.taskName || worklog?.initiativeId || '';

  const processTitle = worklog?.process?.instance?.title || '';
  const processTaskName = worklog?.process?.task?.name || '';

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
    const safeDecodeDeep = (s: string) => {
      let cur = String(s || '');
      for (let i = 0; i < 2; i++) {
        if (!/%[0-9A-Fa-f]{2}/.test(cur)) break;
        try {
          const dec = decodeURIComponent(cur);
          if (!dec || dec === cur) break;
          cur = dec;
        } catch {
          break;
        }
      }
      return cur;
    };

    if (f && typeof f === 'object') {
      const n = f.name || f.originalName || f.filename;
      if (n) return safeDecodeDeep(String(n));
    }
    try {
      const u = new URL(url, (typeof window !== 'undefined' ? window.location.origin : 'http://localhost'));
      const qp = u.searchParams.get('filename') || u.searchParams.get('file') || u.searchParams.get('name') || u.searchParams.get('download') || '';
      const candidate = qp || (u.pathname.split('/').pop() || '') || url;
      const decoded = safeDecodeDeep(candidate);
      if (decoded && decoded !== url) return decoded;
      return safeDecodeDeep(url);
    } catch {
      const last = (url.split('/').pop() || url);
      return safeDecodeDeep(last || url);
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

  function onContentClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === 'IMG') {
      e.preventDefault();
      e.stopPropagation();
      const src = (target as HTMLImageElement).src;
      if (src) setZoomSrc(src);
    }
  }

  const timeSpentMinutes = Number(worklog?.timeSpentMinutes) || 0;
  const progressPct = typeof worklog?.progressPct === 'number' ? worklog.progressPct : (worklog?.progressPct != null ? Number(worklog.progressPct) : null);
  const blockerCode = String(worklog?.blockerCode || '').trim();
  const urgent = !!worklog?.urgent;
  const visibility = worklog?.visibility;

  const showHeader = variant !== 'content';
  const showTitle = variant !== 'content';
  const showContext = variant !== 'content';
  const showMetaBlocks = variant !== 'content';

  const showBody = variant !== 'compact';
  const showAttachments = variant !== 'compact';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {showHeader && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#475569', fontSize: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 22, height: 22, borderRadius: 999, background: '#E2E8F0', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700 }}>{String(who || '?').slice(0, 1)}</div>
          <div style={{ fontWeight: 800, color: '#0f172a' }}>{who}</div>
          {team ? (
            <>
              <div>·</div>
              <div style={{ color: '#334155', fontWeight: 700 }}>{team}</div>
            </>
          ) : null}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {createdAt ? (
              <div style={{ background: '#0F3D73', color: '#FFFFFF', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800 }}>작성 {formatKstDatetime(createdAt)}</div>
            ) : null}
            {workDate ? (
              <div style={{ background: '#F8FAFC', color: '#334155', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, border: '1px solid #E2E8F0' }}>업무일 {formatKstYmd(workDate)}</div>
            ) : null}
            {timeSpentMinutes ? (
              <div style={{ background: '#F8FAFC', color: '#0F3D73', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: '1px solid #CBD5E1' }}>{formatMinutesAsHmKo(timeSpentMinutes)}</div>
            ) : null}
            {visibility ? (
              <div style={{ background: '#F8FAFC', color: '#334155', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600, border: '1px solid #E2E8F0' }}>조회권한 {visibilityKo(visibility)}</div>
            ) : null}
          </div>
        </div>
      )}

      {showTitle && (
        <div style={{ fontWeight: 900, fontSize: variant === 'compact' ? 17 : 20, color: '#0f172a', lineHeight: 1.25 }}>{title || '(제목 없음)'}</div>
      )}

      {showContext && (objectiveTitle || keyResultTitle || initiativeTitle || processTitle || processTaskName) ? (
        <div style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 12, background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
          {(objectiveTitle || keyResultTitle) && (
            <div style={{ fontSize: 12, color: '#334155' }}>
              <b>상위 과제</b>: {objectiveTitle || '-'}{keyResultTitle ? ` / KR: ${keyResultTitle}` : ''}
            </div>
          )}
          {initiativeTitle && (
            <div style={{ fontSize: 12, color: '#334155' }}>
              <b>세부 과제</b>: {initiativeTitle}
            </div>
          )}
          {(processTitle || processTaskName) && (
            <div style={{ fontSize: 12, color: '#334155' }}>
              <b>프로세스</b>: {processTitle || '-'}{processTaskName ? ` / ${processTaskName}` : ''}
            </div>
          )}
        </div>
      ) : null}

      {showMetaBlocks && (progressPct != null || blockerCode || urgent) && (
        <div style={{ display: 'grid', gap: 6, padding: 10, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E5E7EB' }}>
          {progressPct != null && !Number.isNaN(progressPct) && (
            <div style={{ fontSize: 12, color: '#334155' }}>
              <b>진척</b>: {progressPct}%
            </div>
          )}
          {blockerCode && (
            <div style={{ fontSize: 12, color: '#334155' }}>
              <b>차단코드</b>: {blockerCode}
            </div>
          )}
          {urgent && (
            <div style={{ fontSize: 12, color: '#334155' }}>
              <b>긴급</b>: 예
            </div>
          )}
        </div>
      )}

      {showBody && (
        <div>
          {contentHtml ? (
            <div
              className="rich-content"
              style={{ border: '1px solid #eee', borderRadius: 12, padding: 12, background: '#fff' }}
              onClick={onContentClick}
              dangerouslySetInnerHTML={{ __html: toSafeHtml(contentHtml) }}
            />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap', color: '#334155', border: '1px solid #eee', borderRadius: 12, padding: 12, background: '#fff' }}>
              {bodyText || '-'}
            </div>
          )}
        </div>
      )}

      {showBody && Array.isArray(photos) && photos.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#334155' }}>사진</div>
          <div className="attachments" style={{ display: 'grid', gap: 8 }}>
            {photos.map((p: any, i: number) => {
              const raw = pickFileUrl(p);
              const url = absLink(raw);
              const name = pickFileName(p, url);
              return (
                <div className="attachment-item" key={(p?.filename || p?.url || raw || '') + i}>
                  <img
                    src={url}
                    alt={name}
                    style={{ maxWidth: '100%', height: 'auto', borderRadius: 12, cursor: 'zoom-in' }}
                    onClick={(e) => { e.stopPropagation(); setZoomSrc(url); }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showAttachments && Array.isArray(files) && files.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#334155' }}>첨부파일</div>
          <div className="attachments" style={{ display: 'grid', gap: 8 }}>
            {files.map((f: any, i: number) => {
              const raw = pickFileUrl(f);
              const url = absLink(raw);
              const name = pickFileName(f, url);
              const isImg = isImageAttachment(f, url);
              return (
                <div className="attachment-item" key={(f?.filename || f?.url || raw || '') + i}>
                  {isImg ? (
                    <img src={url} alt={name} style={{ maxWidth: '100%', height: 'auto', borderRadius: 12, cursor: 'zoom-in' }} onClick={(e) => { e.stopPropagation(); setZoomSrc(url); }} />
                  ) : (
                    <a className="file-link" href={url} target="_blank" rel="noreferrer">{name}</a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {zoomSrc && (
        <div className="image-overlay" onClick={(e) => { e.stopPropagation(); setZoomSrc(null); }}>
          <img src={zoomSrc} alt="preview" />
        </div>
      )}
    </div>
  );
}
