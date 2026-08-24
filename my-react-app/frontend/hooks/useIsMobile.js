import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * 「視窗寬度是不是手機尺寸」——原本 _search、_camera/result、_favorite 三邊
 * 各自維護一份幾乎逐行相同的 resize 監聽邏輯，這裡抽成共用 hook。
 *
 * 用 lazy initializer 讀一次目前的 window.innerWidth，避免掛載當下先渲染成
 * false（桌面版排版）、等 effect 跑完才修正成 true 的閃爍。
 */
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);

  useEffect(() => {
    const checkScreenSize = () => setIsMobile(window.innerWidth < breakpoint);
    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, [breakpoint]);

  return isMobile;
}
