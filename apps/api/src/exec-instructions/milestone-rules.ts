// 경영지시 팔로우업: 꼭지(Milestone) 상태전이·정체감시 순수 규칙
// 인계문서 HANDOVERFLAGSHIPMODULE.md §5 명세를 그대로 코드화(구현이 아니라 규칙이 자산).
// 부수효과 없음 — DB/알림은 서비스 계층에서.

export type MilestoneStatus = 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'REVIEW' | 'DONE';

export const STALL_DAYS = Number(process.env.STALL_DAYS || 3);
export const REVIEW_NEGLECT_DAYS = 2;
export const NUDGE_MIN_HOURS = 24;

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface MilestoneLike {
  id: string;
  order: number;
  status: MilestoneStatus;
  ownerId?: string | null;
  dueAt?: Date | string | null;
  submittedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  lastNudgeAt?: Date | string | null;
}

function ms(v?: Date | string | null): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// ── 검수 관문 ────────────────────────────────────────────────
// 담당자(비지시자·비관리자)의 완료는 '주장' → REVIEW. 지시자/관리자는 즉시 확정.
export function submitTargetStatus(isPrivileged: boolean): 'DONE' | 'REVIEW' {
  return isPrivileged ? 'DONE' : 'REVIEW';
}

// 검수 확정/반려 권한: 지시자 본인 OR 관리자
export function canReview(actorId: string, authorId: string, isAdmin: boolean): boolean {
  return actorId === authorId || isAdmin;
}

// 완료 확정 시 다음으로 활성화할 꼭지: 남은 PENDING 중 order 최소
export function nextToActivate<T extends MilestoneLike>(milestones: T[], excludeId?: string): T | null {
  const pend = milestones
    .filter((m) => m.id !== excludeId && m.status === 'PENDING')
    .sort((a, b) => a.order - b.order);
  return pend[0] || null;
}

// ── 정체 감시(watchdog) ──────────────────────────────────────
// overdue: 기한 지남 & 미완료 (PENDING 포함 — "시작도 안 함"을 잡는 게 목적)
export function isOverdue(m: MilestoneLike, now: number): boolean {
  const due = ms(m.dueAt);
  return due != null && due < now && m.status !== 'DONE';
}

// stalled: ACTIVE|BLOCKED 이면서 마지막 갱신 후 STALL_DAYS 이상 무소식
export function isStalled(m: MilestoneLike, now: number): boolean {
  if (m.status !== 'ACTIVE' && m.status !== 'BLOCKED') return false;
  const upd = ms(m.updatedAt);
  return upd != null && now - upd >= STALL_DAYS * DAY;
}

// reviewNeglected: REVIEW 이면서 제출 후 REVIEW_NEGLECT_DAYS 이상 방치 → 지시자에게만
export function isReviewNeglected(m: MilestoneLike, now: number): boolean {
  if (m.status !== 'REVIEW') return false;
  const sub = ms(m.submittedAt);
  return sub != null && now - sub >= REVIEW_NEGLECT_DAYS * DAY;
}

// 넛지 최소 간격 24h (중복 알림 방지)
export function nudgeAllowed(m: MilestoneLike, now: number): boolean {
  const last = ms(m.lastNudgeAt);
  return last == null || now - last >= NUDGE_MIN_HOURS * HOUR;
}

export type NudgeKind = 'overdue' | 'stalled' | 'reviewNeglected';

// 한 꼭지에 대해 발동할 넛지 종류(우선순위: reviewNeglected > overdue > stalled)
export function nudgeKind(m: MilestoneLike, now: number): NudgeKind | null {
  if (isReviewNeglected(m, now)) return 'reviewNeglected';
  if (isOverdue(m, now)) return 'overdue';
  if (isStalled(m, now)) return 'stalled';
  return null;
}

// 넛지 수신자: reviewNeglected는 지시자만, 그 외 담당자+지시자(동일인 중복 제거)
export function nudgeRecipients(kind: NudgeKind, ownerId: string | null | undefined, authorId: string): string[] {
  if (kind === 'reviewNeglected') return [authorId];
  const set = new Set<string>([authorId]);
  if (ownerId) set.add(ownerId);
  return Array.from(set);
}
