// Validéo : fonctionnement hors ligne (cache de l'application)
const CACHE = 'valideo-v7';
const SHELL = ['./', './index.html', './app.html', './guide.html', './app.js', './theme.js', './site.css', './config.js', './manifest.webmanifest', './icon.svg',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co') || u.protocol === 'blob:') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request.url.split('?')[0].split('#')[0], cp)); return r; })
      .catch(() => caches.match(e.request.url.split('?')[0].split('#')[0]).then(h => h || caches.match('./app.html'))));
    return;
  }
  // Réseau d'abord pour avoir la dernière version, cache si hors ligne
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
