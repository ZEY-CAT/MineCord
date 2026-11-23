const CACHE_NAME = 'minecord-shell-v2';
const SHELL = ['/app', '/app-theme.css', '/password-settings.js', '/manifest.json', '/calls.js', '/native-oauth.js', '/companion.js', '/companion.css', '/companion.html', '/notifications.js', '/sw.js', '/edition.js', '/features.js', '/desktop-updater.js', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('minecord-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function fetchShell(request, path) {
  let response;
  try {
    response = await fetch(request, { cache: 'no-cache' });
  } catch {
    try {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(path)) || Response.error();
    } catch {
      return Response.error();
    }
  }
  if (response.ok && !response.redirected) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(path, response.clone());
    } catch {
      // A storage failure must not prevent the app from loading online.
    }
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')
      || url.pathname.startsWith('/auth/') || url.pathname === '/ws' || url.pathname.startsWith('/download')) return;
  if (request.mode === 'navigate' ? url.pathname === '/app' : SHELL.includes(url.pathname)) {
    event.respondWith(fetchShell(request, url.pathname));
  }
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch {}
  const allowedKinds = new Set(['message', 'friendOnline', 'call', 'invite']);
  const kind = allowedKinds.has(payload.kind) ? payload.kind : 'message';
  const messages = {
    message: 'You have a new message in MineCord.',
    friendOnline: 'A friend just came online.',
    call: 'You have a MineCord call notification.',
    invite: 'You have a new MineCord invitation.'
  };
  event.waitUntil(self.registration.showNotification('MineCord', {
    body: messages[kind],
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `minecord-${kind}`,
    renotify: false,
    data: { url: '/app' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    return existing ? existing.focus() : self.clients.openWindow('/app');
  }));
});
