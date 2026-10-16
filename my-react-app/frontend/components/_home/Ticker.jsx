import { useLayoutEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useReducedMotion } from "../../src/hooks/useReducedMotion";
import "../../static/css/_home/masthead.css";

// 每秒移動的像素：慢到可以邊看邊讀（沉穩風格，不要像賣場跑馬燈）
const PX_PER_SECOND = 40;
const MIN_DURATION_SECONDS = 20;

/**
 * 首頁跑馬燈（後台「首頁設定」的 marquee_items，見 HOMEPAGE_CONTRACT.md 4.3）。
 *
 * 前台義務（契約）：
 * - 自動捲動超過 5 秒必須有可見的暫停控制（WCAG 2.2.2）：右側 44px 的暫停／播放鈕，
 *   鍵盤與觸控都能操作。暫停狀態只由這顆按鈕決定，不做 hover／焦點自動暫停，
 *   避免按下「播放」後滑鼠或焦點還在上面、畫面卻不動。
 * - 使用者設定減少動態時改為靜態呈現：全部項目換行排開、都讀得到，沒有複本也沒有暫停鈕。
 * - 文字一律以純文字節點渲染，不使用 dangerouslySetInnerHTML。
 * 清單為空時由呼叫端不渲染這個元件（不輸出任何元素）。
 */
const HomeTicker = ({ items }) => {
    const reduced = useReducedMotion();
    const [paused, setPaused] = useState(false);
    const [duration, setDuration] = useState(MIN_DURATION_SECONDS);
    const copyRef = useRef(null);

    // 捲完一輪的時間依內容寬度算，項目多寡都維持同樣的閱讀速度
    useLayoutEffect(() => {
        const el = copyRef.current;
        if (reduced || !el) return undefined;
        const measure = () => setDuration(Math.max(MIN_DURATION_SECONDS, Math.round(el.scrollWidth / PX_PER_SECOND)));
        measure();
        if (typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [items, reduced]);

    if (reduced) {
        return (
            <section className="home-ticker home-ticker--static" aria-label="跑馬燈">
                <ul className="home-ticker__copy home-ticker__copy--static">
                    {items.map((text, i) => <li key={i}>{text}</li>)}
                </ul>
            </section>
        );
    }

    return (
        <section className="home-ticker" aria-label="跑馬燈" data-paused={paused}>
            <div className="home-ticker__viewport">
                <div className="home-ticker__track" style={{ "--ticker-duration": `${duration}s` }}>
                    <ul className="home-ticker__copy" ref={copyRef}>
                        {items.map((text, i) => <li key={i}>{text}</li>)}
                    </ul>
                    {/* 接在後面的複本只為了無縫循環：對輔助技術與搜尋隱藏，避免每個項目讀兩次 */}
                    <ul className="home-ticker__copy" aria-hidden="true" inert>
                        {items.map((text, i) => <li key={i}>{text}</li>)}
                    </ul>
                </div>
            </div>
            <button
                type="button"
                className="home-ticker__toggle"
                aria-label={paused ? "播放跑馬燈" : "暫停跑馬燈"}
                onClick={() => setPaused((p) => !p)}
            >
                {paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
            </button>
        </section>
    );
};

export default HomeTicker;
