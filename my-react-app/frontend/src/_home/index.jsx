import News from "../../components/_home/news"
import FunctionBtn from "../../components/_home/functionBtn"
import "../../static/css/_home/index.css"
import Calendar from "../../components/_home/calendar"
import { useEffect, useRef, useState } from 'react';
import { TRIBES } from "../constants/tribes";

const App = () => {
    const [newsWithImage, setNewsWithImage] = useState([]);
    const [newsWithoutImage, setNewsWithoutImage] = useState([]);
    const [examInfo, setExamInfo] = useState([]);
    const [newsError, setNewsError] = useState(false);
    const [tribe, setTribe] = useState(0);
    const functionBtnRef = useRef(null);
    const activeTribe = TRIBES[tribe];

    useEffect(() => {
        fetch(`${import.meta.env.VITE_API_NEWS_URL}`)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                const exams = data.filter((item) => item.isExam === "T");
                const news = data.filter((item) => item.isExam !== "T");

                setExamInfo(exams);

                const withImg = news.filter((item) => item.image);
                const withoutImg = news.filter((item) => !item.image);
                setNewsWithImage(withImg);
                setNewsWithoutImage(withoutImg);
            })
            .catch((err) => {
                console.error("載入首頁最新消息失敗：", err);
                setNewsError(true);
            });
    }, []);

    return (
        <div className="yy-page homepage">
            <section className="yy-hero home-hero">
                <span className="home-blob home-blob--gold" />
                <span className="home-blob home-blob--red" />
                <span className="home-blob home-blob--blue" />

                <span className="home-streak home-streak--1" aria-hidden="true" />
                <span className="home-streak home-streak--2" aria-hidden="true" />

                <span className="home-sprite home-sprite--gold" aria-hidden="true" />
                <span className="home-sprite home-sprite--red" aria-hidden="true" />
                <span className="home-sprite home-sprite--blue" aria-hidden="true" />

                <div className="home-sticker" aria-hidden="true">
                    <span className="home-sticker-eyelet" />
                    <span className="home-sticker-badge">YUAN・YU</span>
                </div>

                <span className="home-diamond-glyph" aria-hidden="true">◆</span>

                <div className="yy-fade-up">
                    <span className="yy-eyebrow">◆ 原住民族語 · 五族共學 ◆</span>
                    <h1 className="home-title">五族語言，<br />刻進<span className="yy-holo-text">織紋</span>裡的學習旅程</h1>
                    <p className="home-desc">泰雅、布農、阿美、噶瑪蘭、排灣——影像辨識、詞彙遊戲與適性測驗，用鮮明色彩延續族語文化的生命力。</p>
                </div>

                <div className="yy-fade-up home-console">
                    <div className="home-console-shell">
                        <div className="home-console-screen">
                            <div className="home-console-brand">YUAN・YU<span className="home-console-cursor">_</span></div>
                            <div className="home-console-sub">FIVE TRIBES ONLINE</div>
                        </div>
                        <div className="home-console-footer">
                            <span className="home-console-bar" />
                            <span className="home-console-dots">
                                <span />
                                <span />
                            </span>
                        </div>
                    </div>
                </div>

                <button
                    type="button"
                    className="yy-fade-up home-cta"
                    onClick={() => functionBtnRef.current?.scrollIntoView({ behavior: "smooth" })}
                >▸ 開始學習 PRESS START!</button>
            </section>

            <div className="yy-divider" />

            <section className="home-tribes-section">
                <div className="home-tribes-grid">
                    <div className="yy-card yy-fade-up home-tribe-list">
                        <div className="home-tribe-list-title">◆ 五族語言 »</div>
                        {TRIBES.map((t, i) => (
                            <div
                                key={t.slug}
                                role="button"
                                tabIndex={0}
                                className="home-tribe-row"
                                style={{ transform: `scale(${i === tribe ? 1.04 : 1})` }}
                                onClick={() => setTribe(i)}
                                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTribe(i); } }}
                            >
                                <span className="home-tribe-swatch" style={{ background: t.color }} />
                                <span className="home-tribe-name">{t.name}</span>
                                <span className="home-tribe-roman">{t.roman}</span>
                            </div>
                        ))}
                    </div>

                    <div className="yy-card yy-fade-up home-feature-card">
                        <div className="home-feature-head">
                            <span>現正主打</span>
                            <span>◆ ◆ ◆ ◆ ◆</span>
                        </div>
                        <div className="home-feature-image">
                            <span>IMAGE PLACEHOLDER</span>
                        </div>
                        <div className="home-feature-body">
                            <div className="home-feature-title">{activeTribe.name}語主題週</div>
                            <div className="home-feature-sub">{activeTribe.roman} · 點左側清單切換族語</div>
                        </div>
                    </div>
                </div>
            </section>

            <div ref={functionBtnRef}>
                <FunctionBtn />
            </div>
            <Calendar examInfo={examInfo} />
            {newsError && (
                <p className="text-center text-muted" style={{ margin: '1rem 0' }}>
                    目前無法載入最新消息，請稍後再試。
                </p>
            )}
            <News withImage={newsWithImage} withoutImage={newsWithoutImage} />
        </div>
    );
};
export default App;
