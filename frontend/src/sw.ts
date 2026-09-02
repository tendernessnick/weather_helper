/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

import { precacheAndRoute } from 'workbox-precaching';

precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event: PushEvent) => {
  let payload: { title?: string; body?: string; url?: string } = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? '网球天气提醒', {
      body: payload.body ?? '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate?.(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

export {};
