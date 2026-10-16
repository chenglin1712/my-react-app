import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import "../../static/css/_home/news.css"
import { Swiper, SwiperSlide } from "swiper/react"
import { Navigation, Autoplay, EffectFade, A11y } from "swiper/modules"
import "swiper/css"
import "swiper/css/effect-fade"
import "swiper/css/navigation";
import "swiper/css/a11y";
import { useReducedMotion } from "../../src/hooks/useReducedMotion";
import ExternalLink from "../ui/ExternalLink";
import { isExternalUrl } from "../ui/externalUrl";

const News = ({ withImage = [], withoutImage = [], loading = false }) => {
    // 要求降低動態時：停用自動輪播，換張改成立即切換（使用者仍可用左右箭頭手動切）
    const reducedMotion = useReducedMotion();
    // 自動輪播超過 5 秒就要給使用者暫停的方法（WCAG 2.2.2）。三個暫停原因各自獨立：
    //   使用者按暫停鈕、滑鼠停在輪播上（只限真的滑鼠，觸控不算）、鍵盤焦點在輪播內（含暫停鈕）。
    // 「有沒有在輪播」只由 shouldRun 決定，暫停鈕的圖示與文字也看它，不另存一份會失去同步的鏡像狀態。
    // 按「繼續」時，滑鼠或焦點仍在輪播上的那個原因會被「略過」到離開為止，否則按了繼續畫面仍不動。
    // 焦點暫停只認鍵盤焦點（:focus-visible）：用滑鼠點暫停鈕時焦點也會落在按鈕上，
    // 若算進去，按下去的瞬間輪播就先被停掉，按鈕文字翻成「繼續」，這一下點擊就變成「繼續」而不是「暫停」。
    const [swiper, setSwiper] = useState(null);
    const [userPaused, setUserPaused] = useState(false);
    const [hovering, setHovering] = useState(false);
    const [focusWithin, setFocusWithin] = useState(false);
    const [ignoreHover, setIgnoreHover] = useState(false);
    const [ignoreFocus, setIgnoreFocus] = useState(false);
    const shouldRun = !reducedMotion && !userPaused && !(hovering && !ignoreHover) && !(focusWithin && !ignoreFocus);

    useEffect(() => {
        if (!swiper?.autoplay) return;
        if (shouldRun) swiper.autoplay.start();
        else swiper.autoplay.stop();
    }, [swiper, shouldRun]);

    const toggleAutoplay = () => {
        if (shouldRun) {
            setUserPaused(true);
        } else {
            setUserPaused(false);
            if (hovering) setIgnoreHover(true);
            if (focusWithin) setIgnoreFocus(true);
        }
    };
    const onStageFocus = (e) => {
        let keyboard = true;
        try { keyboard = e.target.matches(":focus-visible"); } catch { /* 不支援 :focus-visible 的環境一律當作鍵盤焦點 */ }
        if (keyboard) setFocusWithin(true);
    };
    const onStageBlur = (e) => {
        // 視窗失焦（切分頁、切視窗）時 relatedTarget 是 null，但 document.activeElement 仍是原本的元素：
        // 焦點其實還在輪播裡，不能恢復播放
        const next = e.relatedTarget ?? document.activeElement;
        if (e.currentTarget.contains(next)) return;
        setFocusWithin(false);
        setIgnoreFocus(false);
    };
    const allNews = [...withImage, ...withoutImage];
    const hasImages = withImage.length > 0;

    // 資料還沒回來：顯示和卡片同尺寸的佔位塊，不要先呈現「空列表」再跳出內容
    if (loading) {
        return (
            <section className="news-section" aria-busy="true">
                <div className="news-section-header">
                    <h2 className="news-section-title">活動消息</h2>
                </div>
                <div className="news-card-grid" role="status">
                    <span className="visually-hidden">最新消息載入中…</span>
                    {[0, 1, 2].map((index) => (
                        <span className="yy-skeleton news-card-skeleton" aria-hidden="true" key={index} />
                    ))}
                </div>
            </section>
        );
    }

    return (
        <section className="news-section">
            <div className="news-section-header">
                <h2 className="news-section-title">活動消息</h2>
            </div>

            {allNews.length === 0 ? (
                <p className="news-empty">目前沒有新消息。</p>
            ) : hasImages ? (
                /* 有圖版：左側輪播 + 右側列表 */
                <div className="event-container">
                    <div
                        className="event-left"
                        onPointerEnter={(e) => { if (e.pointerType === "mouse") setHovering(true); }}
                        onPointerLeave={() => { setHovering(false); setIgnoreHover(false); }}
                        onFocus={onStageFocus}
                        onBlur={onStageBlur}
                    >
                        <Swiper
                            // autoplay 是初始化參數，使用者中途改了「減少動態」偏好時重建輪播，才會真的套用
                            key={reducedMotion ? "static" : "auto"}
                            className="news-carousel"
                            modules={[Navigation, Autoplay, EffectFade, A11y]}
                            effect="fade"
                            speed={reducedMotion ? 0 : 300}
                            loop={withImage.length > 1}
                            navigation={true}
                            a11y={{
                                prevSlideMessage: "上一則消息",
                                nextSlideMessage: "下一則消息",
                                slideLabelMessage: null,
                                containerRoleDescriptionMessage: "輪播",
                                itemRoleDescriptionMessage: "消息",
                            }}
                            autoplay={reducedMotion ? false : { delay: 8000, pauseOnMouseEnter: false, disableOnInteraction: false }}
                            onSwiper={setSwiper}
                        >
                            {withImage.map((event) => (
                                <SwiperSlide key={event.id}>
                                    <div className="news-slide">
                                        {/* 標題就寫在下方，圖片是裝飾，alt 留空避免報讀器念兩次 */}
                                        <img decoding="async" loading="lazy" src={event.image} alt="" />
                                        <div className="news-slide-info">
                                            <div className="news-slide-date">
                                                {event.start_date}{event.end_date ? ` ～ ${event.end_date}` : ''}
                                            </div>
                                            <h3>{event.title}</h3>
                                            {isExternalUrl(event.detail) && (
                                                <ExternalLink href={event.detail}>
                                                    查看詳情 →<span className="visually-hidden">：{event.title}</span>
                                                </ExternalLink>
                                            )}
                                        </div>
                                    </div>
                                </SwiperSlide>
                            ))}
                        </Swiper>
                        {!reducedMotion && withImage.length > 1 && (
                            <button
                                type="button"
                                className="news-autoplay-toggle"
                                onClick={toggleAutoplay}
                                aria-label={shouldRun ? "暫停自動輪播" : "繼續自動輪播"}
                            >
                                {shouldRun ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                            </button>
                        )}
                    </div>

                    <div className="event-right">
                        <ul className="text-list">
                            {withoutImage.map((event) => (
                                <li key={event.id}>
                                    <ExternalLink href={event.detail} as="div" className="news-text-item">
                                        <div className="news-text-item-date">{event.start_date}</div>
                                        <div className="news-text-item-content">
                                            <span className="news-tag">{event.tag}</span>
                                            <h3>{event.title}</h3>
                                        </div>
                                    </ExternalLink>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            ) : (
                /* 無圖版：卡片格狀排列 */
                <div className="news-card-grid">
                    {allNews.map((event) => (
                        <ExternalLink
                            key={event.id}
                            href={event.detail}
                            as="div"
                            className="news-card"
                        >
                            <div className="news-card-top">
                                <span className="news-tag">{event.tag}</span>
                                <span className="news-card-date">{event.start_date}</span>
                            </div>
                            <h3 className="news-card-title">{event.title}</h3>
                            {isExternalUrl(event.detail) && <span className="news-card-link" aria-hidden="true">查看詳情 →</span>}
                        </ExternalLink>
                    ))}
                </div>
            )}
        </section>
    );
};
export default News;
