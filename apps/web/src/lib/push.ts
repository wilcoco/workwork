import { apiJson } from './api';

/**
 * 브라우저 푸시(Web Push) 구독 — 앱을 꺼 둬도 알림이 뜨게 한다.
 *  · 크롬·엣지·파이어폭스(윈도우·맥·안드로이드)에서 동작
 *  · 아이폰은 사파리에서 "홈 화면에 추가"로 설치해야 동작한다(iOS 16.4+)
 */
export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

const VAPID = String((import.meta as any)?.env?.VITE_VAPID_PUBLIC_KEY || '');

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID;
}

export async function getRegistration() {
  if (!pushSupported()) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return sub ? 'on' : 'off';
}

/** 켜기 — 권한을 묻고 구독해 서버에 등록 */
export async function enablePush(userId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: '이 브라우저는 푸시를 지원하지 않습니다 (아이폰은 홈 화면에 추가 후 가능)' };
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: '브라우저에서 알림을 차단했습니다. 주소창 왼쪽 자물쇠에서 허용으로 바꿔 주세요.' };
  const reg = await getRegistration();
  if (!reg) return { ok: false, reason: '서비스워커 등록 실패' };
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID) });
  await apiJson('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ userId, subscription: sub.toJSON(), userAgent: navigator.userAgent }) });
  return { ok: true };
}

/** 끄기 — 이 기기만 해제 */
export async function disablePush(userId: string) {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (sub) {
    await apiJson('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ userId, endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return { ok: true };
}

export async function sendTestPush(userId: string) {
  return apiJson<{ sent: number; removed: number }>('/api/push/test', { method: 'POST', body: JSON.stringify({ userId }) });
}
