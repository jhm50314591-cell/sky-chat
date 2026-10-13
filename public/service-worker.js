self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  const notificationId = Number(data.notificationId) || 0;
  event.waitUntil(self.registration.showNotification(data.title || '중도일보 사우회', {
    body: data.body || '새 소식이 도착했습니다.',
    icon: '/joongdo-logo.png',
    badge: '/joongdo-logo.png',
    tag: notificationId ? `sauhoe-${notificationId}` : 'sauhoe-update',
    data: { notificationId, url: data.url || '/' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) target.href = `${self.location.origin}/`;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.navigate(target.href);
      return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
