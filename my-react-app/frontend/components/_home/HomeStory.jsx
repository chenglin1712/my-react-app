import { useEffect, useRef, useState } from "react";
import "../../static/css/_home/story.css";
import { storyProgress, stepForProgress } from "./storyMath";
import { STORY_STEPS } from "./storyContent";

// 首頁捲動敘事「一個詞的旅程」（首頁設計稿，動態強度 9）。
// 桌面：整段釘在畫面上，隨捲動依序切換四步，左側圖樣層一層層往上蓋、大字換成「遇見／看見／記住／回家」。
// 手機與窄螢幕：不釘住，四步全部展開、左側只留第一層圖樣。減少動態時仍隨捲動換步，但不做任何轉場。
// 四步的文字永遠都在畫面上（沒被 display:none），報讀器與鍵盤使用者不需要捲動就能讀完整段。


// 寬螢幕才釘住；斷點與 story.css 的 max-width: 900px 互補
const WIDE = "(min-width: 901px)";

const HomeStory = ({ skipTo = "#home-topics" }) => {
    const sectionRef = useRef(null);
    const stageRef = useRef(null);
    const cueRef = useRef(null);
    const [step, setStep] = useState(0);
    const [swapping, setSwapping] = useState(false);
    const [glyphStep, setGlyphStep] = useState(0);

    useEffect(() => {
        const section = sectionRef.current;
        const stage = stageRef.current;
        if (!section || !stage || typeof window.matchMedia !== "function") return undefined;
        const mq = window.matchMedia(WIDE);
        let frame = 0;

        const update = () => {
            frame = 0;
            if (!mq.matches) return;
            const rect = section.getBoundingClientRect();
            const p = storyProgress({ sectionTop: rect.top, sectionHeight: rect.height, stageHeight: stage.offsetHeight });
            setStep(stepForProgress(p));
            // 進度條與提示用 CSS 變數直接寫在元素上，不經過 React 重繪
            stage.style.setProperty("--story-f", (p * STORY_STEPS.length).toFixed(3));
            if (cueRef.current) {
                cueRef.current.style.setProperty("--story-p", p.toFixed(3));
                cueRef.current.dataset.done = p > 0.92 ? "true" : "false";
            }
        };
        const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };

        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        mq.addEventListener?.("change", onScroll);
        update();
        return () => {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            mq.removeEventListener?.("change", onScroll);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, []);

    // 大字換步：先淡出、換字、再彈回來（淡出 180ms，字換完才上場）
    useEffect(() => {
        if (step === glyphStep) return undefined;
        setSwapping(true);
        const t = setTimeout(() => { setGlyphStep(step); setSwapping(false); }, 180);
        return () => clearTimeout(t);
    }, [step, glyphStep]);

    return (
        <section className="home-story" ref={sectionRef} aria-label="一個詞的旅程">
            <div className="home-story__stage" ref={stageRef}>
                <div className="home-story__art" aria-hidden="true">
                    <div className="home-story__progress">
                        {STORY_STEPS.map((s, i) => <i key={s.title}><b style={{ "--i": i }} /></i>)}
                    </div>
                    {STORY_STEPS.map((s, i) => (
                        <div key={s.title} className={`home-story__layer home-story__layer--${i}${i <= step ? " is-on" : ""}`} />
                    ))}
                    <div className={`home-story__glyph${swapping ? " is-swapping" : ""}`}>{STORY_STEPS[glyphStep].glyph}</div>
                </div>

                <div className="home-story__copy">
                    <p className="home-story__kicker">一個詞的旅程</p>
                    <ol className="home-story__steps">
                        {STORY_STEPS.map((s, i) => (
                            <li key={s.title} className={`home-story__step${i === step ? " is-on" : ""}`}>
                                <span className="home-story__num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                                <b>{s.title}</b>
                                <p>{s.text}</p>
                            </li>
                        ))}
                    </ol>
                    <span className="home-story__cue" ref={cueRef} aria-hidden="true">繼續往下捲動</span>
                    <a className="home-story__skip" href={skipTo}>略過這一段 →</a>
                </div>
            </div>
        </section>
    );
};

export default HomeStory;
