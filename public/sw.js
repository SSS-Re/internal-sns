self.addEventListener('install', (e) => {
  console.log('[Service Worker] Install');
});

self.addEventListener('fetch', (e) => {
  // ネットワークリクエストをそのまま通過させる
  e.respondWith(fetch(e.request));
});