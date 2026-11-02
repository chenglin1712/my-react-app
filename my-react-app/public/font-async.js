// 字型 CSS 不擋住首次繪製：index.html 的字型 <link> 先用 media="print" 載入，載完再切成 all。
// 原本寫成內嵌的 onload 屬性，但 CSP 的 script-src 不開 'unsafe-inline' 時內嵌事件處理器會被擋，
// 所以改成外部腳本綁定（稽核 FE-2）。此腳本以 defer 載入，執行時 <link> 可能已載完也可能還沒。
(function () {
  var links = document.querySelectorAll('link[data-async-font]');
  Array.prototype.forEach.call(links, function (link) {
    var show = function () { link.media = "all"; };
    if (link.sheet) show();
    else link.addEventListener("load", show, { once: true });
  });
})();
