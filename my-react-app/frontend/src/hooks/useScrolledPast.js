import { useEffect, useRef, useState } from 'react';

const DEFAULT_NAVBAR_HEIGHT = 90;

const measureNavbar = () => {
    if (typeof document === 'undefined') return DEFAULT_NAVBAR_HEIGHT;
    return document.querySelector('.navbar')?.offsetHeight || DEFAULT_NAVBAR_HEIGHT;
};

/**
 * 某個區塊「已經被捲到視窗上方（看不到了）」時回傳 past = true；捲回來就變回 false。
 *
 * 用在「頁首很高，捲動後只想留一條精簡工具列」的頁面（例如單詞查詢）：頁首本身不再整塊釘在畫面上，
 * 而是捲出畫面後才出現精簡工具列。offset 是全站導覽列的實際高度（導覽列是 sticky，釘在最上面，
 * 精簡工具列要接在它下面）。不支援 IntersectionObserver 的環境永遠回傳 false（工具列不出現，功能不受影響）。
 */
export const useScrolledPast = () => {
    const ref = useRef(null);
    const [past, setPast] = useState(false);
    const [offset, setOffset] = useState(measureNavbar);

    useEffect(() => {
        const update = () => setOffset(measureNavbar());
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    useEffect(() => {
        const element = ref.current;
        if (!element || typeof IntersectionObserver === 'undefined') return undefined;
        const observer = new IntersectionObserver(
            ([entry]) => setPast(!entry.isIntersecting && entry.boundingClientRect.bottom <= offset),
            // 上緣往內縮導覽列的高度：區塊被導覽列蓋住就算「看不到了」
            { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [offset]);

    return [ref, past, offset];
};
