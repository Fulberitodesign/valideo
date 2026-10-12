// Validéo : fonctionnement hors ligne (cache de l'application)
const CACHE = 'valideo-v15';
const SHELL = ['./', './index.html', './app.html', './guide.html', './legal.html', './app.js?v=15', './theme.js', './site.css', './config.js?v=15', './manifest.webmanifest', './icon.svg',
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
    // no-cache : on revalide toujours auprès du serveur pour récupérer la dernière version
    e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request.url.split('?')[0].split('#')[0], cp)); return r; })
      .catch(() => caches.match(e.request.url.split('?')[0].split('#')[0]).then(h => h || caches.match('./app.html'))));
    return;
  }
  // Réseau d'abord pour avoir la dernière version, cache si hors ligne
  const sameOrigin = u.origin === self.location.origin;
  e.respondWith((sameOrigin ? fetch(e.request, { cache: 'no-cache' }) : fetch(e.request)).then(r => {
    if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
