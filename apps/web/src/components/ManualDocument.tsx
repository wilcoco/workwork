import { toSafeHtml } from '../lib/richText';

/**
 * 업무 매뉴얼 본문 뷰어 — 결재함/내 결재/조회 화면 공용.
 * 리치 본문(contentHtml)이 있으면 그림 포함 HTML로, 없으면 텍스트(content)를 그대로 보여준다.
 */
export function ManualDocument(props: { manual: any }) {
  const m = props.manual || {};
  const attachments: Array<{ url: string; name?: string }> = Array.isArray(m.attachments) ? m.attachments : [];
  const statusKo: Record<string, string> = { DRAFT: '초안', REVIEW: '승인 대기', APPROVED: '승인됨', REJECTED: '반려' };
  return (
    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{m.title || '(제목 없음)'}</b>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {m.user?.name ? `작성자: ${m.user.name}` : ''}{m.user?.orgUnit?.name ? ` · ${m.user.orgUnit.name}` : ''}{m.version ? ` · v${m.version}` : ''}{m.status ? ` · ${statusKo[String(m.status)] || m.status}` : ''}
        </span>
      </div>
      {m.contentHtml ? (
        <div className="rich-body" style={{ fontSize: 13, lineHeight: 1.65, color: '#0f172a', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}
          dangerouslySetInnerHTML={{ __html: toSafeHtml(String(m.contentHtml)) }} />
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6, color: '#0f172a', margin: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, fontFamily: 'inherit' }}>
          {String(m.content || '').trim() || '(내용 없음)'}
        </pre>
      )}
      {attachments.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>📎 첨부파일</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {attachments.map((f, i) => (
              <a key={`${f.url}-${i}`} href={f.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0F3D73', textDecoration: 'underline', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || f.url}</a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
