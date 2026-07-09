/**
 * 업무일지 공개 범위(WorklogVisibility) 접근 판정 — 목록/댓글/알림 어디서든 동일 규칙을 쓴다.
 *
 * visibility: ALL(전체) / MANAGER_PLUS(팀장 이상) / EXEC_PLUS(임원 이상) / CEO_ONLY(대표만)
 * 역할별 열람 가능 범위:
 *  - CEO / EXTERNAL(외부감사 등): 전부
 *  - EXEC(임원): ALL, MANAGER_PLUS, EXEC_PLUS
 *  - MANAGER(팀장): ALL, MANAGER_PLUS
 *  - 그 외(일반): ALL
 * 작성자 본인은 언제나 자기 일지를 본다.
 */
export type WlVis = 'ALL' | 'MANAGER_PLUS' | 'EXEC_PLUS' | 'CEO_ONLY';

export function allowedVisibilities(role?: string | null): WlVis[] {
  const r = String(role || '').toUpperCase();
  if (r === 'CEO' || r === 'EXTERNAL') return ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS', 'CEO_ONLY'];
  if (r === 'EXEC') return ['ALL', 'MANAGER_PLUS', 'EXEC_PLUS'];
  if (r === 'MANAGER') return ['ALL', 'MANAGER_PLUS'];
  return ['ALL'];
}

export function canViewWorklog(
  viewer: { id?: string | null; role?: string | null } | null | undefined,
  wl: { visibility?: string | null; createdById?: string | null } | null | undefined,
): boolean {
  if (!wl) return false;
  const vis = String(wl.visibility || 'ALL').toUpperCase();
  if (vis === 'ALL') return true;
  if (viewer?.id && wl.createdById && wl.createdById === viewer.id) return true; // 작성자 본인
  return allowedVisibilities(viewer?.role).includes(vis as WlVis);
}
