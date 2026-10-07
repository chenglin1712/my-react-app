import { useEffect, useRef, useState } from 'react';

/**
 * 元素第一次捲進視窗時回傳 visible = true（只觸發一次，之後不再變回 false）。
 *
 * 不支援 IntersectionObserver 的環境（舊瀏覽器、測試）一開始就視為已進場：內容永遠不會停在隱藏狀態。
 * 用法：const [ref, visible] = useRevealOnView(); 然後把 ref 掛到元素、依 visible 套 class（見 RevealOnView）。
 */
export const useRevealOnView = ({ threshold = 0.12, rootMargin = '0px 0px -8% 0px' } = {}) => {
    const supported = typeof window !== 'undefined' && 'IntersectionObserver' in window;
    const ref = useRef(null);
    const [visible, setVisible] = useState(!supported);

    useEffect(() => {
        if (visible || !supported) return undefined;
        const element = ref.current;
        if (!element) return undefined;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                setVisible(true);
                observer.disconnect();
            }
        }, { threshold, rootMargin });
        observer.observe(element);
        return () => observer.disconnect();
    }, [visible, supported, threshold, rootMargin]);

    return [ref, visible];
};
