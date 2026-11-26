// 離線頁（offline.html）的「重新載入」按鈕。原本寫成內嵌的 onclick 屬性，但 CSP 的 script-src 不開
// 'unsafe-inline' 時內嵌事件處理器會被擋，所以比照 font-async.js 改成同源外部腳本綁定（稽核 FE1-14）。
// 這個檔案和 offline.html 一起在 service worker 安裝時存進快取，離線時也載得到（見 public/sw.js）。
(function () {
  var button = document.querySelector('[data-offline-reload]');
  if (!button) return;
  button.addEventListener('click', function () {
    window.location.reload();
  });
})();
