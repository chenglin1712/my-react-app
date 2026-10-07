import { useRevealOnView } from "../../src/hooks/useRevealOnView";

/**
 * 捲到才進場的區塊包裝：淡入並由下往上 16px，每個區塊只播放一次。
 * 樣式在 theme-v2.css（.yy-reveal）；降低動態偏好下由全域規則直接到終態。
 */
const RevealOnView = ({ children, delay = 0, className = "" }) => {
    const [ref, visible] = useRevealOnView();
    return (
        <div
            ref={ref}
            className={`yy-reveal${visible ? " is-visible" : ""}${className ? ` ${className}` : ""}`}
            style={delay ? { transitionDelay: `${delay}ms` } : undefined}
        >
            {children}
        </div>
    );
};

export default RevealOnView;
