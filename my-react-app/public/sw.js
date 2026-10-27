// Service worker：只做兩件事，刻意保守。
//   1. 連不上網路時，頁面導覽顯示 /offline.html（而不是瀏覽器的恐龍頁）。
//   2. /assets/ 底下帶雜湊檔名的前端檔案快取起來，重複開啟更快。
// 不碰任何 API、登入、上傳與跨網域請求：這個站的資料都在後端與 Firebase，快取它們會讓使用者看到過期資料或登入狀態錯亂。
// 更新方式：改版時 index.html 與 /assets/ 的檔名都會換，這個檔案本身由 nginx 以 no-cache 提供，瀏覽器每次都會檢查；
// 要清掉舊快取時把 CACHE_VERSION 加一。
const CACHE_VERSION = 'yy-v1';
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const CURRENT_CACHES = new Set([ASSET_CACHE, SHELL_CACHE]);
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // 只刪自己的舊版快取（yy- 開頭且不是目前這兩個），不動同網域其他程式建立的快取
        Promise.all(
          keys.filter((key) => key.startsWith('yy-') && !CURRENT_CACHES.has(key)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 分段請求（影片、音訊的 Range）交給網路：快取只存得了完整的 200 回應
  if (request.headers.has('range')) return;

  // 頁面導覽：一律先走網路（拿到最新版 index.html），失敗才顯示離線頁。
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // 帶雜湊檔名的資源：內容不會變，快取優先。
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        // 只存「同源、沒被導向、狀態 200」的回應：避免把登入導向頁或錯誤頁當成資源永久存起來
        if (response.status === 200 && response.type === 'basic' && !response.redirected) {
          event.waitUntil(cache.put(request, response.clone()));
        }
        return response;
      }),
    );
  }
});
