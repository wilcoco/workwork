/** BPMN 그래프 공통 시각화 헬퍼 — BpmnEditor(편집)와 BpmnMiniView(조회)에서 함께 사용 */

/** 조건식을 사람이 읽는 분기 라벨로 변환 (저장되는 condition 값은 그대로 유지) */
export function friendlyEdgeLabel(condition?: string, isLoopBack?: boolean): string | undefined {
  const c = String(condition || '').trim();
  if (/approval\.status\s*==\s*'APPROVED'/i.test(c)) return '✔ 승인';
  if (/approval\.status\s*==\s*'REJECTED'/i.test(c)) return isLoopBack ? '✖ 반려 → 다시 작성' : '✖ 반려';
  if (isLoopBack) return c ? `↩ ${c}` : '↩ 되돌림';
  return c || undefined;
}

/** 분기 성격에 따른 선 색상: 승인=녹색, 반려/루프백=빨강, 기타=기본 */
export function edgeStroke(condition?: string, isLoopBack?: boolean): string | undefined {
  const c = String(condition || '').trim();
  if (/approval\.status\s*==\s*'REJECTED'/i.test(c) || isLoopBack) return '#dc2626';
  if (/approval\.status\s*==\s*'APPROVED'/i.test(c)) return '#16a34a';
  return undefined;
}
