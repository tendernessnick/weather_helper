/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

// index.html is deliberately NOT precached: a precached shell would keep
// serving the previous UI until a second reload. Navigations are network-first
// (always fresh when online) with the last-seen page cached for offline.
precacheAndRoute(
  (self.__WB_MANIFEST as { url: string }[]).filter((e) => !e.url.endsWith('index.html')),
);

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: 'pages', networkTimeoutSeconds: 3 }),
);

self.addEventListener('push', (event: PushEvent) => {
  let payload: {
    title?: string; body?: string; url?: string;
    variants?: Record<string, { title?: string; body?: string }>;
  } = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() };
  }
  // Pick the notification language matching this device (same rules as the app).
  const pickVariant = (): { title?: string; body?: string } => {
    const langs = [self.navigator.language, ...(self.navigator.languages ?? [])];
    for (const l of langs) {
      const low = l.toLowerCase();
      const key = /^(zh-(tw|hk|mo)|yue)/.test(low) ? 'hant'
        : low.startsWith('en') ? 'en'
          : low.startsWith('zh') ? 'hans' : null;
      if (key && payload.variants?.[key]) return payload.variants[key];
    }
    return {};
  };
  const variant = pickVariant();
  event.waitUntil(
    self.registration.showNotification(variant.title ?? payload.title ?? '球场下雨风险提醒', {
      body: variant.body ?? payload.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url ?? '/courts' },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/courts';
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

clientsClaim();
