import News from "../../components/_home/news"
import "../../static/css/_home/index.css"
import CertificationSection from "../../components/_home/calendar"
import { pickExamSchedule } from "../../components/_home/examScheduleContent"
import { useEffect, useState } from 'react';
import RevealOnView from "../../components/ui/RevealOnView";
import HomeTicker from "../../components/_home/Ticker";
import HomeMasthead from "../../components/_home/Masthead";
import HomePromoVideo, { HomePromoPlaceholder } from "../../components/_home/PromoVideo";
import FeaturedTopics from "../../components/_home/FeaturedTopics";
import { pickFeaturedTopics, DEMO_TOPICS } from "../../components/_home/featuredTopicsContent";
import { pickPromoVideo } from "../../components/_home/promoVideoContent";
import { useHomeNavSlot } from "../homeNavSlot";
import HomeIntro from "../../components/_home/HomeIntro";
import { pickMastheadContent, HOME_LEDE } from "../../components/_home/mastheadContent";
import { mapAnnouncementToNewsItem, HOME_NEWS_MAX } from "../../components/_home/announcementContent";

// 後台首頁版位設定（見 backend/adminapi 的 HomepageConfig）還沒抓回來之前
// 就先用這組預設值渲染——刻意跟後端 model 的欄位預設值一致，這樣設定還沒
// 載入完成的那一瞬間畫面長相跟載入完成後（後台從沒改過設定時）完全一樣，
// 不會有「先顯示一種樣子、資料回來後又跳成另一種樣子」的畫面閃動。
const DEFAULT_HOMEPAGE_CONFIG = {
    show_news_section: true, show_calendar_section: true, news_display_count: 6,
    // 報頭與跑馬燈（S6-1，HOMEPAGE_CONTRACT.md 4.1）：預設全空，與後端預設一致，
    // 設定載入前、載入失敗、後台從沒填過時都不輸出跑馬燈、標語、引言
    marquee_items: [], show_marquee: true,
    tagline: '', show_tagline: true,
    quote_text: '', show_quote: true,
    // 宣傳影片（S6-2）：沒有啟用中的影片就是 null，宣傳區不輸出
    promo_video: null,
};

// 後台公告（backend/adminapi 的 Announcement，見 /adminapi/public/announcements/）
// 是首頁最新消息唯一的資料來源：爬蟲抓到的活動/考試消息會被後台同步機制
// （adminapi/crawler_sync.py）匯入成真正的 Announcement 資料列（source='crawler'），
// 首頁不再直接打 /crawler/news/——避免同一則活動被「即時爬蟲」跟「已匯入的後台公告」同時顯示兩次。
// 轉成 News.jsx 形狀的 mapping 在 announcementContent.js，「所有公告」頁共用同一份。

const HomePage = () => {
    // 合併後、還沒依 news_display_count 裁切的完整清單——裁切邏輯放在
    // render 階段直接算（見下面的 newsWithImage/newsWithoutImage），不是
    // fetch 完就裁切存進 state：後台公告／爬蟲消息的 fetch 跟首頁設定的
    // fetch 是各自獨立的兩個 effect，並行時哪個先回來沒有保證，如果在
    // fetch 完當下就用「當時的」news_display_count 裁切，設定比消息晚回來
    // 時裁切用的會是尚未套用後台設定的預設值，且之後也不會重新裁切。
    const [rawNews, setRawNews] = useState([]);
    // 族語認證時程走獨立端點（爬官網日程表再套後台覆寫），失敗只影響那一欄，可重新載入
    const [examSchedule, setExamSchedule] = useState(null);
    const [scheduleLoading, setScheduleLoading] = useState(true);
    const [scheduleError, setScheduleError] = useState(false);
    const [scheduleReloadKey, setScheduleReloadKey] = useState(0);
    // 本期專題走獨立端點，失敗只是不顯示這一區，不影響設定與公告
    const [featuredTopics, setFeaturedTopics] = useState([]);
    // 專題回來之前先不畫這一區，免得先閃出示意卡再換成真的
    const [topicsSettled, setTopicsSettled] = useState(false);
    const [newsError, setNewsError] = useState(false);
    const [newsLoading, setNewsLoading] = useState(true);
    const [homepageConfig, setHomepageConfig] = useState(DEFAULT_HOMEPAGE_CONFIG);
    // 重新載入最新消息：換一個 key 讓公告的 effect 重跑
    const [reloadKey, setReloadKey] = useState(0);
    // 主選單放在報頭下方（雜誌版）：登記這個空位，Navbar 會把自己畫進來
    const registerNavSlot = useHomeNavSlot()?.setSlot;

    useEffect(() => {
        let cancelled = false;
        fetch('/adminapi/public/homepage-config/')
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (cancelled) return;
                // 後端回傳整包直接覆蓋、沒跟預設值 merge 的話，未來後端漏帶
                // 某個欄位時，那個欄位會變成 undefined 而不是退回預設值。
                setHomepageConfig({ ...DEFAULT_HOMEPAGE_CONFIG, ...data });
            })
            .catch((err) => {
                if (cancelled) return;
                // 抓不到就維持預設值——首頁不能因為這個設定端點掛掉就整頁壞掉，
                // 預設值本身就是「後台從沒動過設定」時的正確畫面。
                console.error("載入首頁版位設定失敗：", err);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetch('/adminapi/public/featured-topics/')
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (cancelled) return;
                setFeaturedTopics(pickFeaturedTopics(data));
                setTopicsSettled(true);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("載入本期專題失敗：", err);
                setFeaturedTopics([]);
                setTopicsSettled(true);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setNewsError(false);
        setNewsLoading(true);
        fetch('/adminapi/public/announcements/')
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (cancelled) return;
                // 所有分類的公告都進最新消息（考試類的標籤是「考試」）；
                // 右欄是認證「時程」，來源是考試時程端點，不是公告。
                setRawNews((data.results ?? []).map(mapAnnouncementToNewsItem));
                setNewsLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("載入最新消息失敗：", err);
                setNewsError(true);
                setNewsLoading(false);
            });
        return () => { cancelled = true; };
    }, [reloadKey]);

    useEffect(() => {
        let cancelled = false;
        setScheduleError(false);
        setScheduleLoading(true);
        fetch(import.meta.env.VITE_API_EXAM_SCHEDULE_URL || '/crawler/exam_schedule/')
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (cancelled) return;
                const picked = pickExamSchedule(data);
                if (!picked) throw new Error('時程資料格式不符');
                setExamSchedule(picked);
                setScheduleLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("載入認證時程失敗：", err);
                setScheduleError(true);
                setScheduleLoading(false);
            });
        return () => { cancelled = true; };
    }, [scheduleReloadKey]);

    // news_display_count 是後台「消息區塊顯示筆數」設定（規劃文件 §3.2.3），
    // 裁切 rawNews 的總筆數，不是各自分開裁切——圖文版跟純文字版是同一份
    // 清單依有沒有圖片分流顯示，裁切要在分流之前做，不然「顯示 6 則」實際上
    // 會變成最多顯示 12 則（圖文各 6）。
    // 首頁只放最新的幾則（最多 HOME_NEWS_MAX 則），後台設定的筆數更少時照後台的；其餘到「所有公告」頁看
    const displayedNews = rawNews.slice(0, Math.min(HOME_NEWS_MAX, homepageConfig.news_display_count));
    const newsWithImage = displayedNews.filter((item) => item.image);
    const newsWithoutImage = displayedNews.filter((item) => !item.image);

    const { marqueeItems, tagline, quote } = pickMastheadContent(homepageConfig);
    const promoVideo = pickPromoVideo(homepageConfig.promo_video);
    // 第一屏左欄：宣傳影片（沒設定就放示意卡）加大標題與說明，永遠佔欄
    const hasLead = true;
    // 第一屏各欄的相對寬度（左欄 5、消息 4、公告 3），沒有的區塊不佔欄
    const firstScreenColumns = [
        hasLead ? 5 : 0,
        homepageConfig.show_news_section ? 4 : 0,
        homepageConfig.show_calendar_section ? 3 : 0,
    ].filter(Boolean);

    return (
        <div className="yy-page homepage">
            {marqueeItems.length > 0 && <HomeTicker items={marqueeItems} />}
            <HomeMasthead quote={quote} tagline={tagline} />

            {/* 主選單的位置：Navbar 在首頁會用 portal 把自己畫進這裡（見 homeNavSlot.jsx） */}
            <div ref={registerNavSlot} className="home-nav-slot" />

            {/* 第一屏：宣傳影片、活動消息、族語認證公告並排（1100px 以上），較窄的螢幕直向堆疊。
                欄寬比 5:4:3，缺的區塊不佔欄，剩下的重新分配；三塊都沒有就不輸出這一層。 */}
            {firstScreenColumns.length > 0 && (
                <div
                    className="home-first"
                    style={{ "--home-first-cols": firstScreenColumns.map((fr) => `minmax(0, ${fr}fr)`).join(" ") }}
                >
                    {hasLead && (
                        <RevealOnView className="home-first__lead">
                            {/* 有啟用中的影片才輸出；換影片或媒體路徑、可播放狀態有變，就整個重建播放狀態 */}
                            {promoVideo
                                ? <HomePromoVideo key={`${promoVideo.id}|${promoVideo.videoUrl}|${promoVideo.coverUrl}|${promoVideo.playable}`} video={promoVideo} />
                                : <HomePromoPlaceholder />}
                            <HomeIntro title={tagline} lede={HOME_LEDE} />
                        </RevealOnView>
                    )}
                    {homepageConfig.show_news_section && (
                        <RevealOnView delay={70}>
                            <News
                                withImage={newsWithImage}
                                withoutImage={newsWithoutImage}
                                loading={newsLoading}
                                error={newsError}
                                onRetry={() => setReloadKey((n) => n + 1)}
                            />
                        </RevealOnView>
                    )}
                    {homepageConfig.show_calendar_section && (
                        <RevealOnView delay={140}><CertificationSection
                                schedule={examSchedule}
                                loading={scheduleLoading}
                                error={scheduleError}
                                onRetry={() => setScheduleReloadKey((n) => n + 1)}
                            /></RevealOnView>
                    )}
                </div>
            )}

            {/* 本期專題：沒有已發布的專題就放三張示意卡（設計稿的版面），發布後自動換成真的 */}
            {topicsSettled && (
                <RevealOnView><FeaturedTopics topics={featuredTopics.length > 0 ? featuredTopics : DEMO_TOPICS} /></RevealOnView>
            )}
        </div>
    );
};
export default HomePage;
