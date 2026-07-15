/** 지식 배지 — AI 심사를 통과한 기록임을 나타내는 '시스템 인증' 비주얼 */

/** 목록/제목용 인증 칩: ✓ 체크 인장 + 'AI 지식인증' */
export function KbBadge({ note, count }: { note?: string | null; count?: number | null }) {
  return (
    <span
      title={note || 'AI 심사: 다른 구성원에게 도움이 되는 지식 기록으로 인증됨'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6,
        padding: '1px 8px 1px 4px', borderRadius: 999, fontSize: 11, fontWeight: 800,
        color: '#7c4a03', background: 'linear-gradient(135deg,#fef3c7,#fde68a)',
        border: '1px solid #f59e0b', boxShadow: '0 1px 2px rgba(245,158,11,0.35)',
        verticalAlign: 'middle', whiteSpace: 'nowrap', lineHeight: 1.6,
      }}
    >
      <span style={{
        width: 14, height: 14, borderRadius: 999, background: 'radial-gradient(circle at 30% 30%, #fbbf24, #d97706)',
        color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 900,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.4)',
      }}>✓</span>
      AI 지식인증{typeof count === 'number' && count > 0 ? ` ${count}회` : ''}
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
