/** 지식 배지 — AI 심사를 통과한 기록임을 나타내는 '시스템 인증' 비주얼 */

/**
 * 목록/제목용 인증 칩 — 두 정보를 시각적으로 분리:
 *  · 골드 세그먼트 "✓ AI 지식인증" = 지금 이 일지가 인증받았다는 표시
 *  · 네이비 세그먼트 "작성자 누적 N" = 작성자의 전체 인증 횟수(이 일지와 별개)
 */
export function KbBadge({ note, count }: { note?: string | null; count?: number | null }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 6, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
      <span
        title={note || 'AI 심사: 이 업무일지가 지식 기록으로 인증되었습니다'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '1px 8px 1px 4px', fontSize: 11, fontWeight: 800,
          color: '#7c4a03', background: 'linear-gradient(135deg,#fef3c7,#fde68a)',
          border: '1px solid #f59e0b', boxShadow: '0 1px 2px rgba(245,158,11,0.35)',
          borderRadius: typeof count === 'number' && count > 1 ? '999px 0 0 999px' : 999,
          lineHeight: 1.6,
        }}
      >
        <span style={{
          width: 14, height: 14, borderRadius: 999, background: 'radial-gradient(circle at 30% 30%, #fbbf24, #d97706)',
          color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4)',
        }}>✓</span>
        AI 지식인증
      </span>
      {typeof count === 'number' && count > 1 && (
        <span
          title={`작성자의 누적 지식 인증 횟수: ${count}회 (이 일지 포함)`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '1px 8px', fontSize: 10, fontWeight: 700,
            color: '#e2e8f0', background: '#0F3D73',
            border: '1px solid #0F3D73', borderLeft: 'none',
            borderRadius: '0 999px 999px 0', lineHeight: 1.7,
          }}
        >
          작성자 누적 {count}
        </span>
      )}
    </span>
  );
}

/** 상세 문서용 인증서 블록: 인장 + 인증 문구 + AI 심사평 */
export function KbBadgeSeal({ note, count }: { note?: string | null; count?: number | null }) {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center',
      border: '1px solid #f59e0b', background: 'linear-gradient(135deg,#fffbeb,#fef3c7)',
      borderRadius: 10, padding: '10px 14px',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 999, flexShrink: 0,
        background: 'radial-gradient(circle at 30% 30%, #fcd34d, #d97706)',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 900, fontSize: 18, boxShadow: '0 2px 6px rgba(217,119,6,0.45), inset 0 0 0 2px rgba(255,255,255,0.35)',
      }}>✓</div>
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={{ fontWeight: 800, color: '#92400e', fontSize: 13, letterSpacing: 0.2 }}>
          AI 지식 인증 <span style={{ fontWeight: 600, color: '#b45309', fontSize: 11 }}>— 시스템이 심사한 우수 지식 기록입니다</span>
          {typeof count === 'number' && count > 0 ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: '#92400e', background: '#fde68a', border: '1px solid #f59e0b', borderRadius: 999, padding: '1px 8px' }}>작성자 누적 인증 {count}회</span> : null}
        </div>
        {note ? <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>“{note}”</div> : null}
      </div>
    </div>
  );
}
