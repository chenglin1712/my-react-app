// 測試用：jsdom 沒有 matchMedia，而左側頁面清單用 react-bootstrap 的響應式 Offcanvas（md 以上直接顯示、以下收成抽屜），
// 它靠 matchMedia 判斷寬度。這裡把「寬度 >= 斷點」的查詢都當成成立，也就是模擬電腦版，清單就會直接顯示在畫面上。
// 要測手機抽屜的測試，自己用 setViewport(false) 改成窄螢幕。
export function mockViewport(isDesktop = true) {
  window.matchMedia = (query) => ({
    matches: /min-width/.test(query) ? isDesktop : !isDesktop,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
}
