// 我ai学习 — Service Worker (app-shell offline cache)
const CACHE = 'kycg-v33';
const SHELL = [
  'app.html',
  'index.html',
  'guide.html',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
  'splash-1290-2796.png',
  'splash-1284-2778.png',
  'splash-1179-2556.png',
  'splash-1170-2532.png',
  'splash-1125-2436.png',
  'splash-828-1792.png',
  'splash-750-1334.png',
  'splash-1668-2388.png',
  'splash-2048-2732.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  // 仅缓存同源静态资源，接口/跨域直接放行
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 离线且缓存未命中时兜底返回首页
        if (req.mode === 'navigate') return caches.match('app.html');
      });
    })
  );
});
