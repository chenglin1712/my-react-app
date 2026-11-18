import { useEffect, useState } from "react";

/**
 * 把一條浮動列（筆記底部操作列）的實際高度寫成 <html> 上的 CSS 變數，列不在了就移除。
 * 用途：右下角的 AI 助手啟動鈕要浮在這條列的上方，而列在窄螢幕可能換行成兩列，高度不固定，
 * 所以用量出來的真實高度，不用猜。沒有 ResizeObserver 的環境（舊瀏覽器、測試）只量一次。
 *
 * 同時在 <html> 加上 data-floating-bar 屬性：CSS 靠這個屬性（不靠 :has()，舊瀏覽器也認得）知道「現在有一條浮動列」。
 *
 * 回傳的是「callback ref」，掛在那條列的元素上。不用 useRef + useEffect，因為筆記頁在資料載入完之前顯示骨架，
 * 操作列是之後才出現的；useEffect 只在第一次渲染跑，那時元素還不存在，就永遠量不到。
 */
export function useFloatingBarHeight(cssVar = "--note-toolbar-h") {
  const [el, setEl] = useState(null);

  useEffect(() => {
    if (!el) return undefined;
    const root = document.documentElement;
    const write = () => root.style.setProperty(cssVar, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    root.setAttribute("data-floating-bar", "");
    write();
    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(write);
      observer.observe(el);
    }
    return () => {
      observer?.disconnect();
      root.style.removeProperty(cssVar);
      root.removeAttribute("data-floating-bar");
    };
  }, [el, cssVar]);

  return setEl;
}
