// 防閃白：在任何樣式表之前，同步讀取儲存的主題偏好並設定 <html data-theme>（見 DESIGN.md「深淺色政策」）。
// 規則與 frontend/src/theme/themeStore.js 相同：只認 light | dark | system，其他或讀取失敗一律淺色；
// 公開深色切換的功能旗標（VITE_ENABLE_DARK_THEME）沒開時一律淺色。
// 旗標由 index.html 以 data-dark-enabled 屬性帶進來（Vite 只替換 index.html 內的 %VAR%，不處理 public/ 的檔案）。
// 這是外部小檔而不是內嵌腳本，CSP 的 script-src 才不必開 'unsafe-inline'（稽核 FE-2）。
(function () {
  var theme = "light";
  try {
    var self = document.currentScript;
    if (self && self.getAttribute("data-dark-enabled") === "true") {
      var saved = window.localStorage.getItem("yy-theme");
      if (saved === "dark" || saved === "system") theme = saved;
    }
  // eslint-disable-next-line no-unused-vars
  } catch (e) { /* 讀不到儲存空間就當淺色 */ }
  document.documentElement.setAttribute("data-theme", theme);
})();
