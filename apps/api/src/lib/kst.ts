/**
 * 외부 시스템(입출입 기록 등)에서 받은 시각 문자열을 안전하게 Date로 파싱한다.
 *
 * 배경: KT텔레캅/에스원/캡스의 입출입 기록은 SQL Server에 타임존 없는(naive)
 * KST 벽시계 값으로 저장돼 있고, 수집기(access_sync.py)가 `.isoformat()`으로
 * 오프셋 없이 보낸다(예: "2024-12-15T14:30:00"). 이를 `new Date()`로 그냥 파싱하면
 * 서버(UTC) 로컬로 해석돼 실제보다 9시간 앞으로 저장된다.
 *
 * 규칙: 문자열에 타임존 오프셋(Z 또는 ±HH:MM)이 이미 있으면 그대로 파싱하고,
 * 없으면 KST(+09:00)로 간주해 파싱한다. (이미 올바른 값에 이중 오프셋을 주지 않음)
 */
export function parseKstDate(raw?: string | null): Date | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // 이미 타임존 오프셋이 있으면(끝이 Z 또는 +09:00 / +0900 / -05:00 등) 그대로 파싱
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/.test(s);
  if (!hasTz) {
    // 공백 구분("YYYY-MM-DD HH:MM:SS")을 ISO 'T' 형태로 정규화 후 KST 오프셋 부여
    s = s.replace(' ', 'T') + '+09:00';
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
