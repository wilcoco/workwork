/**
 * 알림 중계 등록소 — Notification이 만들어질 때 바깥으로 보내는 통로들을 모아 둔다.
 * PrismaService(미들웨어)가 PushService를 직접 주입받으면 순환 의존이 되므로 이 작은 등록소를 쓴다.
 * 지금 등록된 것: 브라우저 푸시. (Teams 중계는 PrismaService가 직접 호출한다)
 */
export type NotificationRelay = (userId: string, notification: { type: string; subjectType?: string; subjectId?: string; payload?: any }) => void | Promise<void>;

const relays: NotificationRelay[] = [];
export function onNotification(fn: NotificationRelay) { relays.push(fn); }
export function emitNotification(userId: string, notification: any) {
  for (const fn of relays) { try { void fn(userId, notification); } catch { /* 중계 실패가 본 흐름을 막지 않는다 */ } }
}
