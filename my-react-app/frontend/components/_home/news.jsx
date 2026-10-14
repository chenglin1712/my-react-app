import { useState } from "react";
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
    // 自動輪播超過 5 秒就要給使用者暫停的方法（WCAG 2.2.2）：滑鼠移入自動暫停，鍵盤與觸控用右上角的暫停鈕
    const [swiper, setSwiper] = useState(null);
    const [playing, setPlaying] = useState(true);
    const toggleAutoplay = () => {
        if (!swiper?.autoplay) return;
        if (swiper.autoplay.running) swiper.autoplay.stop();
        else swiper.autoplay.start();
    };
    const allNews = [...withImage, ...withoutImage];
    const hasImages = withImage.length > 0;

    // 資料還沒回來：顯示和卡片同尺寸的佔位塊，不要先呈現「空列表」再跳出內容
    if (loading) {
        return (
            <section className="news-section" aria-busy="true">
                <div className="news-section-header">
                    <div className="news-section-title-group">
                        <span className="news-section-label">NEWS</span>
                        <h2 className="news-section-title">活動消息</h2>
                    </div>
                    <div className="news-section-divider" />
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
                <div className="news-section-title-group">
                    <span className="news-section-label">NEWS</span>
                    <h2 className="news-section-title">活動消息</h2>
                </div>
                <div className="news-section-divider" />
            </div>

            {allNews.length === 0 ? (
                <p className="news-empty">目前沒有新消息。</p>
            ) : hasImages ? (
                /* 有圖版：左側輪播 + 右側列表 */
                <div className="event-container">
                    <div className="event-left">
                        <Swiper
                            modules={[Navigation, Autoplay, EffectFade, A11y]}
                            effect="fade"
                            speed={reducedMotion ? 0 : 500}
                            loop={withImage.length > 1}
                            navigation={true}
                            a11y={{ prevSlideMessage: "上一則消息", nextSlideMessage: "下一則消息", slideLabelMessage: null }}
                            autoplay={reducedMotion ? false : { delay: 8000, pauseOnMouseEnter: true }}
                            onSwiper={setSwiper}
                            onAutoplayStart={() => setPlaying(true)}
                            onAutoplayStop={() => setPlaying(false)}
                            grabCursor={true}
                        >
                            {withImage.map((event) => (
                                <SwiperSlide key={event.id}>
                                    <div className="news-slide">
                                        <img src={event.image} alt={event.title} />
                                        <div className="news-slide-info">
                                            <div className="news-slide-date">
                                                {event.start_date}{event.end_date ? ` ～ ${event.end_date}` : ''}
                                            </div>
                                            <h3>{event.title}</h3>
                                            {isExternalUrl(event.detail) && (
                                                <ExternalLink href={event.detail}>查看詳情 →</ExternalLink>
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
                                aria-label={playing ? "暫停自動輪播" : "繼續自動輪播"}
                            >
                                {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
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
                                            <span className="news-tag" data-tag={event.tag}>{event.tag}</span>
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
                                <span className="news-tag" data-tag={event.tag}>{event.tag}</span>
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