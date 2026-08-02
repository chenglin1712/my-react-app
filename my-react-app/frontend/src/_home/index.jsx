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
// 現在是首頁消息／族語認證公告唯一的資料來源：爬蟲抓到的活動/考試消息會被
// 後台同步機制（adminapi/crawler_sync.py）匯入成真正的 Announcement 資料列
// （source='crawler'），首頁不再直接打 /crawler/news/——避免同一則活動被
// 「即時爬蟲」跟「已匯入的後台公告」同時顯示兩次。
//
// 轉成 News.jsx／Calendar.jsx 既有元件的欄位形狀（沿用爬蟲資料原本的命名，
// 不是文字內容）：
// - start_date 優先用 display_date_text（活動/考試本身的起訖日期文字，見
//   models.py 的欄位說明），沒有的話才退回格式化的 publish_at——後台自建
//   的公告沒有 display_date_text，這時 publish_at 才是唯一能顯示的日期。
// - tag 優先用 source_tag（爬蟲來源原始的分類文字，保留首頁卡片標籤顏色
//   的多樣性），沒有的話才退回 4 個固定分類的中文標籤。
const _formatPublishDate = (publishAt) => (
    publishAt ? new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium' }).format(new Date(publishAt)) : ''
);

const mapAnnouncementToNewsItem = (item) => ({
    title: item.title,
    detail: item.link_url || '',
    image: item.cover_image_url || null,
    start_date: item.display_date_text || _formatPublishDate(item.publish_at),
    end_date: null,
    tag: item.source_tag || ANNOUNCEMENT_CATEGORY_LABELS[item.category] || item.category,
    isExam: 'F',
});

// Calendar.jsx（族語認證最新公告）只需要 title/detail/start_date 三個欄位，
// 跟 News.jsx 的形狀不同，不能共用同一個 map 函式。
const mapAnnouncementToExamItem = (item) => ({
    title: item.title,
    detail: item.link_url || '',
    start_date: item.display_date_text || _formatPublishDate(item.publish_at),
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
        fetch('/adminapi/public/announcements/')
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                const announcements = data.results ?? [];
                // category='exam' 的公告（含爬蟲匯入的族語認證消息）進 Calendar
                // 的「族語認證最新公告」區塊，其餘進 News 消息區塊——維持匯入
                // 前「考試消息只出現在 Calendar、不會同時出現在 News」的行為。
                const examAnnouncements = announcements.filter((item) => item.category === 'exam');
                const newsAnnouncements = announcements.filter((item) => item.category !== 'exam');

                setExamInfo(examAnnouncements.map(mapAnnouncementToExamItem));
                setRawNews(newsAnnouncements.map(mapAnnouncementToNewsItem));
            })
            .catch((err) => {
                console.error("載入最新消息失敗：", err);
                setNewsError(true);
            });
    }, []);

    // news_display_count 是後台「消息區塊顯示筆數」設定（規劃文件 §3.2.3），
    // 裁切 rawNews 的總筆數，不是各自分開裁切——圖文版跟純文字版是同一份
    // 清單依有沒有圖片分流顯示，裁切要在分流之前做，不然「顯示 6 則」實際上
    // 會變成最多顯示 12 則（圖文各 6）。
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
