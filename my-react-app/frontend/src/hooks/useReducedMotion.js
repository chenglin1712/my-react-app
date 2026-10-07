import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** 目前是否要求降低動態（不訂閱變化，給事件處理器用）。不支援 matchMedia 的環境（SSR、測試）視為否。 */
export const prefersReducedMotion = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;

/** 依使用者偏好回傳是否降低動態，偏好在使用中改變時會跟著更新。 */
export const useReducedMotion = () => {
    const [reduced, setReduced] = useState(prefersReducedMotion);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
        const media = window.matchMedia(QUERY);
        const onChange = (event) => setReduced(event.matches);
        setReduced(media.matches);
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
    }, []);

    return reduced;
};

/** scrollIntoView / scrollTo 用的行為：降低動態時直接跳到位置，不做平滑捲動。 */
export const scrollBehavior = () => (prefersReducedMotion() ? 'auto' : 'smooth');
