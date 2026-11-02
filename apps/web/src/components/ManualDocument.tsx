import { toSafeHtml, escapeHtml } from '../lib/richText';
import { apiUrl } from '../lib/api';

/**
 * 업무 매뉴얼 본문 뷰어 — 결재함/내 결재/조회/흐름지도 공용.
 * 리치 본문(contentHtml)이 있으면 그림 포함 HTML로, 없으면 텍스트(content)를 HTML로 변환해
 * "[이미지: url]"는 그림으로, URL·관련문서는 클릭 가능한 링크로 살린다(toSafeHtml이 자동 링크·절대경로 처리).
 */
function textToHtml(text: string): string {
  return String(text || '').split(/\r?\n/).map((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return '<p><br></p>';
    const img = line.match(/^\s*\[이미지:\s*(\S+?)\s*\]\s*$/);
    if (img) return `<p><img src="${escapeHtml(img[1])}"></p>`;
    if (/^###\s*STEP/i.test(line)) return `<h3>${escapeHtml(line)}</h3>`;
    if (/^##\s/.test(line)) return `<h2>${escapeHtml(line)}</h2>`;
    return `<p>${escapeHtml(line)}</p>`;
  }).join('');
}

export function ManualDocument(props: { manual: any }) {
  const m = props.manual || {};
  const attachments: Array<{ url: string; name?: string }> = Array.isArray(m.attachments) ? m.attachments : [];
  const statusKo: Record<string, string> = { DRAFT: '초안', REVIEW: '승인 대기', APPROVED: '승인됨', REJECTED: '반려' };
  const rawHtml = m.contentHtml ? String(m.contentHtml) : textToHtml(String(m.content || ''));
  return (
    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{m.title || '(제목 없음)'}</b>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {m.user?.name ? `작성자: ${m.user.name}` : ''}{m.user?.orgUnit?.name ? ` · ${m.user.orgUnit.name}` : ''}{m.version ? ` · v${m.version}` : ''}{m.status ? ` · ${statusKo[String(m.status)] || m.status}` : ''}
        </span>
      </div>
      {rawHtml.trim() ? (
        <div className="rich-body" style={{ fontSize: 13, lineHeight: 1.65, color: '#0f172a', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}
          dangerouslySetInnerHTML={{ __html: toSafeHtml(rawHtml) }} />
      ) : (
        <div style={{ fontSize: 12.5, color: '#94a3b8', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}>(내용 없음)</div>
      )}
      {attachments.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>📎 첨부파일 {attachments.length}개</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {attachments.map((f, i) => (
              <a key={`${f.url}-${i}`} href={/^https?:/i.test(String(f.url)) ? f.url : apiUrl(String(f.url))} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0F3D73', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name || f.url}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
