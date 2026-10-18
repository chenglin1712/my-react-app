import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
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

// 沒有圖片的消息（含圖片載入失敗）圖區畫的圖樣有三款，依序輪替
const PATTERN_COUNT = 3;
// 有圖時，輪播下方的列表最多幾則；全部都沒圖時整欄是列表，最多幾則
const MAX_LIST_WITH_CAROUSEL = 3;
const MAX_LIST_ONLY = 5;

// 輪播的封面：圖片是裝飾（標題就寫在下方，alt 留空避免報讀器念兩次）；載入失敗退回圖樣，不留破圖
const SlidePic = ({ image, index }) => {
    const [failed, setFailed] = useState(false);
    if (image && !failed) {
        return <img decoding="async" loading="lazy" src={image} alt="" onError={() => setFailed(true)} />;
    }
    return <div className="news-slide-pattern" data-pattern={index % PATTERN_COUNT} aria-hidden="true" />;
};

const News = ({ withImage = [], withoutImage = [], loading = false, error = false, onRetry }) => {
    const titleId = useId();
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

    const hasCarousel = withImage.length > 0;
    const listItems = hasCarousel
        ? withoutImage.slice(0, MAX_LIST_WITH_CAROUSEL)
        : withoutImage.slice(0, MAX_LIST_ONLY);

    const header = (
        <div className="news-section-header">
            <h2 className="news-section-title" id={titleId}>最新消息</h2>
        </div>
    );

    // 資料還沒回來：骨架和內容同尺寸，不要先呈現「空列表」再跳出內容
    if (loading) {
        return (
            <section className="news-section" aria-labelledby={titleId} aria-busy="true">
                {header}
                <div className="news-skeleton" role="status">
                    <span className="visually-hidden">最新消息載入中…</span>
                    <span className="yy-skeleton news-skeleton__tall" aria-hidden="true" />
                    {[0, 1, 2].map((index) => (
                        <span className="yy-skeleton news-skeleton__row" aria-hidden="true" key={index} />
                    ))}
                </div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="news-section" aria-labelledby={titleId}>
                {header}
                <div className="news-state" role="alert">
                    <p>目前無法載入最新消息，請稍後再試。</p>
                    {onRetry && <button type="button" className="news-state__btn" onClick={onRetry}>重新載入</button>}
                </div>
            </section>
        );
    }

    if (withImage.length + withoutImage.length === 0) {
        return (
            <section className="news-section" aria-labelledby={titleId}>
                {header}
                <div className="news-state"><p className="news-empty">目前沒有新消息。</p></div>
            </section>
        );
    }

    return (
        <section className="news-section" aria-labelledby={titleId}>
            {header}

            {hasCarousel && (
                <div
                    className="news-stage"
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
                        navigation={withImage.length > 1}
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
                        {withImage.map((event, index) => (
                            <SwiperSlide key={event.id}>
                                <div className="news-slide">
                                    <SlidePic image={event.image} index={index} />
                                    <div className="news-slide-info">
                                        <div className="news-slide-meta">
                                            <span className="news-tag" data-tag={event.tag}>{event.tag}</span>
                                            <span className="news-slide-date">
                                                {event.start_date}{event.end_date ? ` ～ ${event.end_date}` : ''}
                                            </span>
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
            )}

            {listItems.length > 0 && (
                <ul className={`text-list yy-stagger${hasCarousel ? "" : " text-list--only"}`}>
                    {listItems.map((event, index) => (
                        <li key={event.id} style={{ "--i": index }}>
                            <ExternalLink href={event.detail} as="div" className="news-text-item">
                                <span className="news-text-item-date">{event.start_date}</span>
                                {/* 有輪播時列表只放日期與標題（和設計稿一致）；只有列表時才多顯示分類標籤 */}
                                <span className="news-tag news-text-item-tag" data-tag={event.tag}>{event.tag}</span>
                                <h3>{event.title}</h3>
                            </ExternalLink>
                        </li>
                    ))}
                </ul>
            )}

            <Link className="news-more" to="/announcements">查看更多公告 <span aria-hidden="true">→</span></Link>
        </section>
    );
};
export default News;
