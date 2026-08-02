import News from "../../components/_home/news"
import FunctionBtn from "../../components/_home/functionBtn"
import "../../static/css/_home/index.css"
import Calendar from "../../components/_home/calendar"
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { TRIBES } from "../constants/tribes";

const ANNOUNCEMENT_CATEGORY_LABELS = { announcement: '公告', activity: '活動', exam: '考試', maintenance: '系統維護' };

// 後台首頁版位設定（見 backend/adminapi 的 HomepageConfig）還沒抓回來之前
// 就先用這組預設值渲染——刻意跟後端 model 的欄位預設值一致，這樣設定還沒
// 載入完成的那一瞬間畫面長相跟載入完成後（後台從沒改過設定時）完全一樣，
// 不會有「先顯示一種樣子、資料回來後又跳成另一種樣子」的畫面閃動。
const DEFAULT_HOMEPAGE_CONFIG = {
    hero_image_url: '', hero_link_url: '', hero_title_override: '',
    show_news_section: true, show_calendar_section: true, news_display_count: 6,
    button1_enabled: true, button2_enabled: true, button3_enabled: true,
};

// 後台公告（backend/adminapi 的 Announcement，見 /adminapi/public/announcements/）
// 跟這個元件既有的 News 元件（componenets/_home/news.jsx）共用同一套渲染，
// 轉成同樣的欄位形狀——News.jsx 用 event.detail 當連結網址（沿用爬蟲資料原本
// 的命名，不是文字內容），公告沒有設定外部連結時給空字串，等同不可點但不會
// 噴錯（href="" 只是連回目前頁面）。
const mapAnnouncementToNewsItem = (item) => ({
    title: item.title,
    detail: item.link_url || '',
    image: item.cover_image_url || null,
    start_date: item.publish_at
        ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium' }).format(new Date(item.publish_at))
        : '',
    end_date: null,
    tag: ANNOUNCEMENT_CATEGORY_LABELS[item.category] ?? item.category,
    isExam: 'F',
});

const App = () => {
    // 合併後、還沒依 news_display_count 裁切的完整清單——裁切邏輯放在
    // render 階段直接算（見下面的 newsWithImage/newsWithoutImage），不是
    // fetch 完就裁切存進 state：後台公告／爬蟲消息的 fetch 跟首頁設定的
    // fetch 是各自獨立的兩個 effect，並行時哪個先回來沒有保證，如果在
    // fetch 完當下就用「當時的」news_display_count 裁切，設定比消息晚回來
    // 時裁切用的會是尚未套用後台設定的預設值，且之後也不會重新裁切。
    const [rawNews, setRawNews] = useState([]);
    const [examInfo, setExamInfo] = useState([]);
    const [newsError, setNewsError] = useState(false);
    const [tribe, setTribe] = useState(0);
    const [homepageConfig, setHomepageConfig] = useState(DEFAULT_HOMEPAGE_CONFIG);
    const functionBtnRef = useRef(null);
    const activeTribe = TRIBES[tribe];

    useEffect(() => {
        fetch('/adminapi/public/homepage-config/')
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(setHomepageConfig)
            .catch((err) => {
                // 抓不到就維持預設值——首頁不能因為這個設定端點掛掉就整頁壞掉，
                // 預設值本身就是「後台從沒動過設定」時的正確畫面。
                console.error("載入首頁版位設定失敗：", err);
            });
    }, []);

    useEffect(() => {
        // 用 allSettled 而不是 all：外部爬蟲來源（tacp.gov.tw／exam.sce.ntnu.
        // edu.tw）跟後台公告是兩個獨立來源，其中一個掛掉不該連累另一個也顯示
        // 不出來——只有兩邊都失敗時才真的顯示「無法載入」。
        Promise.allSettled([
            fetch(`${import.meta.env.VITE_API_NEWS_URL}`).then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            }),
            fetch('/adminapi/public/announcements/').then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            }),
        ]).then(([crawlerResult, announcementResult]) => {
            if (crawlerResult.status === 'rejected') {
                console.error("載入外部最新消息失敗：", crawlerResult.reason);
            }
            if (announcementResult.status === 'rejected') {
                console.error("載入後台公告失敗：", announcementResult.reason);
            }
            if (crawlerResult.status === 'rejected' && announcementResult.status === 'rejected') {
                setNewsError(true);
            }

            const crawlerData = crawlerResult.status === 'fulfilled' ? crawlerResult.value : [];
            const announcements = announcementResult.status === 'fulfilled' ? (announcementResult.value.results ?? []) : [];

            const exams = crawlerData.filter((item) => item.isExam === "T");
            const crawlerNews = crawlerData.filter((item) => item.isExam !== "T");
            // 後台公告排最前面（規劃文件 §3.2.1：「後台內容永遠排在前面」）。
            const news = [...announcements.map(mapAnnouncementToNewsItem), ...crawlerNews];

            setExamInfo(exams);
            setRawNews(news);
        });
    }, []);

    // news_display_count 是後台「消息區塊顯示筆數」設定（規劃文件 §3.2.3），
    // 裁切整個合併清單（後台公告＋爬蟲消息）的總筆數，不是各自分開裁切——
    // 圖文版跟純文字版是同一份清單依有沒有圖片分流顯示，裁切要在分流之前做，
    // 不然「顯示 6 則」實際上會變成最多顯示 12 則（圖文各 6）。
    const displayedNews = rawNews.slice(0, homepageConfig.news_display_count);
    const newsWithImage = displayedNews.filter((item) => item.image);
    const newsWithoutImage = displayedNews.filter((item) => !item.image);

    const heroTitle = homepageConfig.hero_title_override || `${activeTribe.name}語主題週`;
    const featureCardContent = (
        <>
            <div className="home-feature-head">
                <span>現正主打</span>
                <span>◆ ◆ ◆ ◆ ◆</span>
            </div>
            <div className="home-feature-image">
                {homepageConfig.hero_image_url
                    ? <img src={homepageConfig.hero_image_url} alt={heroTitle} />
                    : <span>IMAGE PLACEHOLDER</span>}
            </div>
            <div className="home-feature-body">
                <div className="home-feature-title">{heroTitle}</div>
                <div className="home-feature-sub">{activeTribe.roman} · 點左側清單切換族語</div>
            </div>
        </>
    );

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

                    {homepageConfig.hero_link_url ? (
                        homepageConfig.hero_link_url.startsWith('http') ? (
                            <a
                                className="yy-card yy-fade-up home-feature-card"
                                href={homepageConfig.hero_link_url}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {featureCardContent}
                            </a>
                        ) : (
                            <Link className="yy-card yy-fade-up home-feature-card" to={homepageConfig.hero_link_url}>
                                {featureCardContent}
                            </Link>
                        )
                    ) : (
                        <div className="yy-card yy-fade-up home-feature-card">{featureCardContent}</div>
                    )}
                </div>
            </section>

            <div ref={functionBtnRef}>
                <FunctionBtn enabled={{
                    button1: homepageConfig.button1_enabled,
                    button2: homepageConfig.button2_enabled,
                    button3: homepageConfig.button3_enabled,
                }} />
            </div>
            {homepageConfig.show_calendar_section && <Calendar examInfo={examInfo} />}
            {homepageConfig.show_news_section && (
                <>
                    {newsError && (
                        <p className="text-center text-muted" style={{ margin: '1rem 0' }}>
                            目前無法載入最新消息，請稍後再試。
                        </p>
                    )}
                    <News withImage={newsWithImage} withoutImage={newsWithoutImage} />
                </>
            )}
        </div>
    );
};
export default App;
