import { useEffect, useState } from "react";

// 從實際渲染出來的 h2 建立目錄（Apple 化步驟 4-9）：依序補上 id，空標題的 h2 不列入。
// 直接讀 DOM 而不是另外解析內容，標題與 id 一定對得上。ref 指向包住正文的元素；ready 為 false 時目錄為空。
export const TOC_MIN_ITEMS = 3;

export function useHeadingToc(ref, ready, idPrefix, deps = []) {
    const [items, setItems] = useState([]);
    useEffect(() => {
        if (!ready || !ref.current) { setItems([]); return; }
        const next = [];
        ref.current.querySelectorAll("h2").forEach((el, i) => {
            el.id = `${idPrefix}-${i + 1}`;
            const title = el.textContent.trim();
            if (title) next.push({ id: el.id, title });
        });
        setItems(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready, idPrefix, ref, ...deps]);
    return items;
}
