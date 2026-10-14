/* ===== sw.js — Service Worker：安裝到桌面 + 完全離線快取 ===== */
/* 更新內容時把版本號 +1，即可讓使用者端更新快取 */
const CACHE = 'ipas-netzero-v1';

/* App shell：以相對路徑列出，兼容 file://、localhost 與 GitHub Pages 子路徑 */
const ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'data/questions.js',
  'data/learning_content.js',
  'js/store.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-192-maskable.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 快取優先，取不到再走網路；導覽請求離線時回退至快取的 index.html */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === 'navigate') return caches.match('index.html');
        });
    })
  );
});
