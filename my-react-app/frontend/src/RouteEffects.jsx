import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { getPageTitle } from './routeMeta';

const isTypingTarget = (element) => {
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
};

// 前台換頁時的三件事（單頁應用程式不會自己做，瀏覽器原本換頁會做的）：
// 1. 更新分頁標題
// 2. 一般點連結換頁時捲回頂端；按上一頁／下一頁（POP）交給瀏覽器還原位置，不去動
// 3. 把鍵盤焦點移到新頁的主要內容，螢幕報讀器才知道頁面換了
//    （不然焦點會留在已經被卸載的導覽連結上）。使用者正在輸入時不搶焦點。
export default function RouteEffects() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = getPageTitle(pathname);
  }, [pathname]);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    if (navigationType === 'POP' || hash) return undefined;
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { /* 測試環境沒有實作 */ }
    const frame = requestAnimationFrame(() => {
      if (isTypingTarget(document.activeElement)) return;
      const main = document.getElementById('main-content');
      const target = main?.querySelector('h1') || main;
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, navigationType, hash]);

  return null;
}
