// Web Push handlers, pulled into the generated service worker via
// workbox.importScripts (see vite.config.js). They have to live in the service
// worker because that is what the browser wakes to deliver a push - the page
// itself is usually closed.
//
// Only ever runs on a secure origin: browsers refuse to register a service
// worker over plain HTTP, which ErgDash deliberately supports on a LAN. Those
// installs get the in-app centre and webhooks instead.
/* global self, clients */

self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'ErgDash', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'ErgDash', {
      body: payload.body || '',
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      // Collapses repeats of the same event into one entry in the tray rather
      // than stacking them.
      tag: payload.kind ? `ergdash-${payload.kind}` : 'ergdash',
      data: { link: payload.link || '/', id: payload.id },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  const target = new URL(link, self.location.origin).href;

  // Focus an open ErgDash tab and navigate it rather than piling up new ones.
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.navigate ? client.navigate(target).then(c => c.focus()) : client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
