// Service worker：只做兩件事，刻意保守。
//   1. 連不上網路時，頁面導覽顯示 /offline.html（而不是瀏覽器的恐龍頁）。
//   2. /assets/ 底下帶雜湊檔名的前端檔案快取起來，重複開啟更快。
// 不碰任何 API、登入、上傳與跨網域請求：這個站的資料都在後端與 Firebase，快取它們會讓使用者看到過期資料或登入狀態錯亂。
// 更新方式：改版時 index.html 與 /assets/ 的檔名都會換，這個檔案本身由 nginx 以 no-cache 提供，瀏覽器每次都會檢查；
// 要清掉舊快取、或 offline.html／offline.js 改了內容時，把 CACHE_VERSION 加一。
// yy-v2：稽核 FE1-14、FE1-22 改了離線頁並新增 offline.js；加一也順便清掉 yy-v1 累積的舊版 /assets/ 檔。
const CACHE_VERSION = 'yy-v2';
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const CURRENT_CACHES = new Set([ASSET_CACHE, SHELL_CACHE]);
const OFFLINE_URL = '/offline.html';
// 離線頁的「重新載入」按鈕由這支同源腳本綁定（CSP 不允許內嵌 onclick），離線時也要拿得到，所以一起存
const OFFLINE_SCRIPT_URL = '/offline.js';

// 稽核 FE1-13：每次部署的新雜湊檔都存進同一個 ASSET_CACHE，舊檔從不移除；而 sw.js 本身在一般部署時不會變，
// activate 不會再跑，只靠 activate 清不到。所以每次存入新檔後修剪：Cache API 的 keys() 依存入順序排列，
// 超過上限就從最早存的刪起——舊版部署的檔案一定比目前版本早存入，會先被刪掉。
// 上限取一次完整建置的檔案數（約 340 個，一般使用者只會載到其中一部分）再留一些餘裕。
const MAX_ASSET_ENTRIES = 400;

async function trimAssetCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_ASSET_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    // addAll 是全有或全無：offline.js 抓不到會讓整個 service worker 安裝失敗，連離線頁都沒有。
    // 離線頁照舊必須存到；腳本另外存、失敗就算了（只是離線時「重新載入」鈕沒反應，仍可用瀏覽器重新整理）。
    caches.open(SHELL_CACHE).then((cache) => Promise.all([
      cache.add(new Request(OFFLINE_URL, { cache: 'reload' })),
      cache.add(new Request(OFFLINE_SCRIPT_URL, { cache: 'reload' })).catch(() => {}),
    ])),
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
      // 稽核 FE1-13：新版 service worker 啟用時也修剪一次目前的資源快取
      .then(() => caches.open(ASSET_CACHE))
      .then((cache) => trimAssetCache(cache))
      .catch(() => {})
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

  // 離線頁的腳本：先走網路，連不上才用安裝時存的那份
  if (url.pathname === OFFLINE_SCRIPT_URL) {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_SCRIPT_URL)));
    return;
  }

  // 帶雜湊檔名的資源：內容不會變，快取優先。
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        // 網路失敗（請求被瀏覽器中途取消、換頁、斷線）時自己接住，回傳標準的網路錯誤回應；
        // 不接的話 respondWith 的 promise 會 reject，console 出現紅字「Uncaught (in promise) TypeError: Failed to fetch」。
        // 頁面端的 import() 仍會照常收到載入失敗，由前端 lazyWithRetry（frontend/src/lazyWithRetry.js）自動重新載入一次。
        let response;
        try {
          response = await fetch(request);
        } catch {
          return Response.error();
        }
        // 只存「同源、沒被導向、狀態 200」的回應：避免把登入導向頁或錯誤頁當成資源永久存起來
        // 也不存 text/html：檔案不存在（例如換版後舊檔被清掉）時，伺服器可能把 index.html 當 200 回來，
        // 存下來就會讓這個網址永遠回 HTML、script 載入失敗。
        const type = (response.headers?.get?.('content-type') || '').toLowerCase();
        if (response.status === 200 && response.type === 'basic' && !response.redirected && !type.includes('text/html')) {
          // 存不進去（儲存空間滿等）只是少了快取，不該讓 service worker 報錯
          event.waitUntil(
            cache.put(request, response.clone()).then(() => trimAssetCache(cache)).catch(() => {}),
          );
        }
        return response;
      }),
    );
  }
});
