import { KbBadge, KbBadgeSeal } from './KbBadge';
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { apiFetch, apiUrl } from '../lib/api';
import { toSafeHtml } from '../lib/richText';
import { toOneDriveDirectUrl } from '../lib/onedrive';
import { formatKstDatetime, formatKstYmd, formatMinutesAsHmKo } from '../lib/time';
import { UserAvatar } from './UserAvatar';

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

type SupplementItem = {
  id: string;
  userId: string;
  user: { id: string; name: string };
  content: string | null;
  attachments: any;
  createdAt: string;
};

function WorklogSupplementSection({ worklogId, worklogAuthorId }: { worklogId: string; worklogAuthorId: string }) {
  const currentUserId = typeof localStorage !== 'undefined' ? (localStorage.getItem('userId') || '') : '';
  const isAuthor = !!currentUserId && currentUserId === worklogAuthorId;

  const [items, setItems] = useState<SupplementItem[]>([]);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [links, setLinks] = useState<Array<{ url: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/worklogs/${worklogId}/supplements`);
      const json = await res.json();
      setItems(json.items || []);
    } catch {}
  }, [worklogId]);

  useEffect(() => { void load(); }, [load]);

  function handleAddUrl() {
    const raw = urlInput.trim();
    if (!raw) return;
    if (!/^https?:\/\//i.test(raw)) { setError('http(s)로 시작하는 OneDrive URL을 입력하세요'); return; }
    const direct = toOneDriveDirectUrl(raw);
    const label = raw.split('/').pop()?.split('?')[0] || raw;
    setLinks((prev) => [...prev, { url: direct, name: decodeURIComponent(label) }]);
    setUrlInput('');
    setError(null);
  }

  async function handleSubmit() {
    if (!content.trim() && links.length === 0) { setError('내용 또는 OneDrive 링크를 입력하세요'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/worklogs/${worklogId}/supplements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUserId,
          content: content.trim() || undefined,
          attachments: links.length > 0 ? { files: links } : undefined,
        }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j?.message || '저장 실패'); }
      setContent('');
      setLinks([]);
      setUrlInput('');
      setOpen(false);
      await load();
    } catch (e: any) {
      setError(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  const fmtDt = (s: string) => new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const isImg = (f: any) => /sharepoint\.com\/:i:\//i.test(String(f.url || '')) || /1drv\.ms\/i\//i.test(String(f.url || '')) || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(String(f.url || ''));

  if (!isAuthor && items.length === 0) return null;

  return (
    <div style={{ borderTop: '2px dashed #e2e8f0', marginTop: 16, paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: items.length > 0 ? 10 : 0 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#0F3D73' }}>수정·보완 {items.length > 0 && <span style={{ fontWeight: 400, color: '#94a3b8' }}>({items.length})</span>}</span>
        {isAuthor && !open && (
          <button onClick={() => setOpen(true)} style={{ fontSize: 12, padding: '3px 10px', background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>+ 보완 추가</button>
        )}
      </div>

      {items.map((it) => (
        <div key={it.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: '3px solid #0F3D73', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 12, color: '#64748b' }}>
            <span style={{ fontWeight: 700, color: '#0f172a' }}>{it.user?.name || it.userId}</span>
            <span>·</span>
            <span>{fmtDt(it.createdAt)}</span>
            <span style={{ marginLeft: 'auto', background: '#e0f2fe', color: '#0369a1', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>수정보완</span>
          </div>
          {it.content && <div style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{it.content}</div>}
          {Array.isArray(it.attachments?.files) && it.attachments.files.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {it.attachments.files.map((f: any, i: number) => (
                isImg(f)
                  ? <img key={i} src={toOneDriveDirectUrl(f.url)} alt={f.name} style={{ maxWidth: 240, maxHeight: 180, borderRadius: 6, objectFit: 'cover' }} />
                  : <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb', textDecoration: 'underline' }}>📎 {f.name || f.url}</a>
              ))}
            </div>
          )}
        </div>
      ))}

      {isAuthor && open && (
        <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: 12, marginTop: 8 }}>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="수정·보완 내용을 입력하세요"
            rows={4}
            style={{ width: '100%', boxSizing: 'border-box', padding: 8, border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddUrl())}
              placeholder="OneDrive 공유 URL 붙여넣기 후 Enter 또는 추가"
              style={{ flex: 1, padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            />
            <button onClick={handleAddUrl} style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>추가</button>
          </div>
          {links.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {links.map((lk, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, padding: '3px 8px' }}>
                  <span style={{ flex: 1, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📎 {lk.name}</span>
                  <button onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14 }}>×</button>
                </div>
              ))}
            </div>
          )}
          {error && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => { setOpen(false); setContent(''); setLinks([]); setUrlInput(''); setError(null); }} style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>취소</button>
            <button onClick={handleSubmit} disabled={saving} style={{ fontSize: 12, padding: '4px 12px', background: '#0F3D73', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', marginLeft: 'auto' }}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WorklogDocument({ worklog, variant }: { worklog: any; variant?: 'full' | 'compact' | 'content' }) {
  // 지식 인증 일지면 작성자 누적 인증 횟수를 조회해 인장에 표시
  const [kbCount, setKbCount] = useState<number | null>(null);
  useEffect(() => {
    const uid = worklog?.createdById || worklog?.createdBy?.id || worklog?.userId;
    if (!worklog?.kbBadge || !uid || variant === 'compact') { setKbCount(null); return; }
    apiFetch(`/api/worklogs/kb-count?userId=${encodeURIComponent(String(uid))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setKbCount(typeof d?.count === 'number' ? d.count : null))
      .catch(() => setKbCount(null));
  }, [worklog?.kbBadge, worklog?.createdById, variant]);

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
  const whoId = worklog?.createdById || worklog?.createdBy?.id || worklog?.userId || '';
  const whoName = worklog?.createdBy?.name || worklog?.userName || '';
  const who = whoName || whoId || '';
  const team = worklog?.createdBy?.orgUnit?.name || worklog?.teamName || '';

  const objectiveTitle = worklog?.initiative?.keyResult?.objective?.title || '';
  const keyResultTitle = worklog?.initiative?.keyResult?.title || '';
  const initiativeTitle = worklog?.initiative?.title || worklog?.initiativeTitle || worklog?.taskName || worklog?.initiativeId || '';

  const processTitle = worklog?.process?.instance?.title || '';
  const processTaskName = worklog?.process?.task?.name || '';

  function absLink(url: string): string {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return toOneDriveDirectUrl(url);
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
    if (/(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url)) return true;
    // OneDrive / SharePoint "image" share links use /:i:/ in the path.
    if (/sharepoint\.com\/:i:\//i.test(url) || /1drv\.ms\/i\//i.test(url)) return true;
    return false;
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
          <UserAvatar userId={String(whoId || '')} name={whoName || who} size={22} />
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
        <div style={{ fontWeight: 900, fontSize: variant === 'compact' ? 17 : 20, color: '#0f172a', lineHeight: 1.25 }}>
          {title || '(제목 없음)'}
          {worklog?.kbBadge && <KbBadge note={worklog?.kbBadgeNote} />}
        </div>
      )}
      {showTitle && worklog?.kbBadge && variant !== 'compact' && <KbBadgeSeal note={worklog?.kbBadgeNote} count={kbCount} />}

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

      {showBody && Array.isArray(worklog?.tags?.hashTags) && worklog.tags.hashTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {worklog.tags.hashTags.map((ht: string, i: number) => (
            <span key={i} style={{ display: 'inline-block', background: '#EFF6FF', color: '#1e40af', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>#{ht}</span>
          ))}
        </div>
      )}

      {showBody && worklog?.keywords && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>키워드:</span>
          {String(worklog.keywords).split(',').map((kw: string) => kw.trim()).filter(Boolean).map((kw: string, i: number) => (
            <span key={i} style={{ display: 'inline-block', background: '#F0FDF4', color: '#166534', borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600, border: '1px solid #BBF7D0' }}>{kw}</span>
          ))}
        </div>
      )}

      {showBody && (() => {
        const sd = worklog?.structuredData;
        const hasStructuredForm = !!sd && (
          (Array.isArray(sd.todayTasks) && sd.todayTasks.length > 0) ||
          (Array.isArray(sd.ongoingTasks) && sd.ongoingTasks.length > 0) ||
          (Array.isArray(sd.issues) && sd.issues.length > 0) ||
          (Array.isArray(sd.tomorrowPlan) && sd.tomorrowPlan.length > 0) ||
          (typeof sd.remarks === 'string' && sd.remarks.trim())
        );
        if (!hasStructuredForm) return null;
        const statusLabel = (s: string) => s === 'completed' ? '완료' : s === 'in_progress' ? '진행' : '대기';
        const statusColor = (s: string) => s === 'completed' ? '#16a34a' : s === 'in_progress' ? '#2563eb' : '#94a3b8';
        return (
          <div style={{ display: 'grid', gap: 10, border: '1px solid #E5E7EB', borderRadius: 12, padding: 14, background: '#FAFBFC' }}>
            {Array.isArray(sd.todayTasks) && sd.todayTasks.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 6 }}>1. 금일 수행 업무</div>
                {sd.todayTasks.map((t: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#334155', padding: '3px 0' }}>
                    <span style={{ background: statusColor(String(t.status ?? '')), color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>{statusLabel(String(t.status ?? ''))}</span>
                    <span style={{ fontWeight: 600 }}>{String(t.name ?? '')}</span>
                    {t.detail && <span style={{ color: '#64748b' }}>— {String(t.detail ?? '')}</span>}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(sd.ongoingTasks) && sd.ongoingTasks.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 6 }}>2. 진행 중 업무</div>
                {sd.ongoingTasks.map((t: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#334155', padding: '3px 0' }}>
                    <span style={{ background: '#EFF6FF', color: '#1e40af', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 600 }}>{Number(t.progressPct) || 0}%</span>
                    <span style={{ fontWeight: 600 }}>{String(t.name ?? '')}</span>
                    {t.nextAction && <span style={{ color: '#64748b' }}>→ {String(t.nextAction ?? '')}</span>}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(sd.issues) && sd.issues.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#b91c1c', marginBottom: 6 }}>3. 이슈 / 문제</div>
                {sd.issues.map((t: any, i: number) => (
                  <div key={i} style={{ fontSize: 13, color: '#334155', padding: '3px 0', borderLeft: '3px solid #fca5a5', paddingLeft: 8 }}>
                    <div><b>문제:</b> {String(t.problem ?? '')}</div>
                    {t.cause && <div style={{ color: '#64748b' }}><b>원인:</b> {String(t.cause ?? '')}</div>}
                    {t.support && <div style={{ color: '#64748b' }}><b>지원:</b> {String(t.support ?? '')}</div>}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(sd.tomorrowPlan) && sd.tomorrowPlan.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 6 }}>4. 익일 계획</div>
                {sd.tomorrowPlan.map((t: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#334155', padding: '3px 0' }}>
                    <span style={{ fontWeight: 600 }}>{String(t.task ?? '')}</span>
                    {t.goal && <span style={{ color: '#64748b' }}>(목표: {String(t.goal ?? '')})</span>}
                  </div>
                ))}
              </div>
            )}
            {sd.remarks && String(sd.remarks).trim() && (
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 6 }}>5. 특이사항 / 건의</div>
                <div style={{ fontSize: 13, color: '#334155', whiteSpace: 'pre-wrap' }}>{String(sd.remarks).trim()}</div>
              </div>
            )}
          </div>
        );
      })()}

      {showBody && (() => {
        const sd = worklog?.structuredData;
        const hasStructuredForm = !!sd && (
          (Array.isArray(sd.todayTasks) && sd.todayTasks.length > 0) ||
          (Array.isArray(sd.ongoingTasks) && sd.ongoingTasks.length > 0) ||
          (Array.isArray(sd.issues) && sd.issues.length > 0) ||
          (Array.isArray(sd.tomorrowPlan) && sd.tomorrowPlan.length > 0) ||
          (typeof sd.remarks === 'string' && sd.remarks.trim())
        );
        if (hasStructuredForm) return null;
        return (
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
        );
      })()}

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
              const isImg = isImageAttachment(f, url) || isImageAttachment(f, raw);
              return (
                <div className="attachment-item" key={(f?.filename || f?.url || raw || '') + i}>
                  {isImg ? (
                    <img src={url} alt={name} style={{ maxWidth: '100%', height: 'auto', borderRadius: 12, cursor: 'zoom-in' }} onClick={(e) => { e.stopPropagation(); setZoomSrc(url); }} />
                  ) : (
                    <a className="file-link" href={url} target="_blank" rel="noreferrer" download={name}>{name}</a>
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

      {variant !== 'compact' && worklog?.id && (
        <WorklogSupplementSection
          worklogId={String(worklog.id)}
          worklogAuthorId={String(worklog.createdById || worklog.createdBy?.id || worklog.userId || '')}
        />
      )}
    </div>
  );
}
