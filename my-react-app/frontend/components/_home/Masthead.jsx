import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../src/hooks/useReducedMotion";
import "../../static/css/_home/masthead.css";

// 「原語」疊影的靜止位置（單位：字高的倍數），滑鼠移動時往反方向偏，離開再彈回
const REST = 0.055;
const FOLLOW = 0.14;

/**
 * 三欄報頭：左「原語」（兩個字各自進場）、中引言（置中）、右英文刊名「YUAN・YU」與標語。
 * 「原語」與「YUAN・YU」是固定品牌字；引言與標語空白或關閉時不輸出。
 * 滑鼠（不含觸控）在報頭上移動時，「原語」的疊影會跟著微移；要求降低動態時不移動。
 * 疊影位置用 ref 直接寫進 CSS 變數，不經過 React state（每個 pointermove 都重繪會卡）。
 */
const HomeMasthead = ({ quote = "", tagline = "" }) => {
    const reduced = useReducedMotion();
    const mastRef = useRef(null);
    const nameRef = useRef(null);

    useEffect(() => {
        const mast = mastRef.current;
        const name = nameRef.current;
        if (reduced || !mast || !name) return undefined;
        let cx = REST;
        let cy = REST;
        let tx = REST;
        let ty = REST;
        let raf = 0;
        const put = () => {
            name.style.setProperty("--sx", cx.toFixed(4));
            name.style.setProperty("--sy", cy.toFixed(4));
        };
        const step = () => {
            cx += (tx - cx) * FOLLOW;
            cy += (ty - cy) * FOLLOW;
            if (Math.abs(tx - cx) < 0.0008 && Math.abs(ty - cy) < 0.0008) {
                cx = tx;
                cy = ty;
                put();
                raf = 0;
                return;
            }
            put();
            raf = requestAnimationFrame(step);
        };
        const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
        const onMove = (e) => {
            if (e.pointerType !== "mouse") return;
            const r = mast.getBoundingClientRect();
            const dx = (e.clientX - r.left) / r.width - 0.5;
            const dy = (e.clientY - r.top) / r.height - 0.5;
            tx = Math.max(-0.11, Math.min(0.11, -dx * 0.26));
            ty = Math.max(-0.02, Math.min(0.12, -dy * 0.3 + 0.03));
            kick();
        };
        const onLeave = () => { tx = REST; ty = REST; kick(); };
        mast.addEventListener("pointermove", onMove);
        mast.addEventListener("pointerleave", onLeave);
        return () => {
            mast.removeEventListener("pointermove", onMove);
            mast.removeEventListener("pointerleave", onLeave);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [reduced]);

    return (
        <header ref={mastRef} className={`home-mast${quote ? "" : " home-mast--no-quote"}`}>
            <h1 ref={nameRef} className="home-mast__name" aria-label="原語">
                <span className="home-mast__ch" style={{ "--i": 0 }} aria-hidden="true">原</span>
                <span className="home-mast__ch" style={{ "--i": 1 }} aria-hidden="true">語</span>
            </h1>
            {quote && <p className="home-mast__quote">{quote}</p>}
            <div className="home-mast__en">
                <span className="home-mast__en-name">YUAN・YU</span>
                {tagline && <span className="home-mast__tagline">{tagline}</span>}
            </div>
        </header>
    );
};

export default HomeMasthead;
