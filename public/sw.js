// Offline support. The build fills in BUILD (a hash of the app's files) and ASSETS (the scripts and styles to precache).
const BUILD = 'dev';
const ASSETS = [];
const WASM = [];
const SHELL = `imagee-shell-${BUILD}`;
// AI models and the WebAssembly runtime are large and rarely change, so they live in their own cache across app updates.
const RUNTIME = 'imagee-runtime-v1';
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './icons/icon-32.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', ...ASSETS];
const isRuntime = url => url.pathname.includes('/models/') || url.pathname.endsWith('.wasm');

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Old app versions go; the runtime cache only keeps files the new version still uses.
    for (const key of await caches.keys()) if (key !== SHELL && key !== RUNTIME) await caches.delete(key);
    const runtime = await caches.open(RUNTIME);
    const wasm = new Set(WASM.map(path => new URL(path, self.registration.scope).href));
    if (BUILD !== 'dev') for (const request of await runtime.keys()) if (request.url.endsWith('.wasm') && !wasm.has(request.url)) await runtime.delete(request);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        // Only a real copy of the app replaces the offline shell, never an error page.
        const scope = new URL(self.registration.scope).pathname;
        if (response.ok && (url.pathname === scope || url.pathname === `${scope}index.html`)) {
          const copy = response.clone();
          void caches.open(SHELL).then(cache => cache.put('./index.html', copy));
        }
        return response;
      }).catch(async () => (await caches.match('./index.html')) || Response.error())
    );
    return;
  }
  const cacheName = isRuntime(url) ? RUNTIME : SHELL;
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(cacheName).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => new Response('', { status: 504, statusText: 'Offline' })))
  );
});
