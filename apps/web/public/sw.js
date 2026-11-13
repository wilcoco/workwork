/* WorkWork 브라우저 알림 서비스워커 — 앱을 꺼 둬도 알림을 받는다 */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: '알림', body: event.data ? event.data.text() : '' }; }
  const title = d.title || '알림';
  const options = {
    body: d.body || '',
    icon: '/logo.png',
    badge: '/logo.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      // 이미 열린 탭이 있으면 그 탭을 쓰고, 해당 화면으로 이동시킨다
      if ('focus' in c) { try { await c.focus(); } catch {} ; try { c.navigate(url); } catch {} ; return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
