import { useEffect, useState } from 'react';

/**
 * active 為 true 持續超過 delay 毫秒才回傳 true（預設 1 秒）。
 * 用在載入骨架：很快就載好的頁面不會先閃一下骨架再換內容；active 變回 false 時立刻歸零。
 */
export default function useDelayedVisible(active, delay = 1000) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return undefined;
    }
    const id = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(id);
  }, [active, delay]);
  return active && visible;
}
