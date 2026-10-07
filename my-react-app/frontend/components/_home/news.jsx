import "../../static/css/_home/news.css"
import { Swiper, SwiperSlide } from "swiper/react"
import { Navigation, Autoplay, EffectFade } from "swiper/modules"
import "swiper/css"
import "swiper/css/effect-fade"
import "swiper/css/navigation";
import { useReducedMotion } from "../../src/hooks/useReducedMotion";

const News = ({ withImage = [], withoutImage = [], loading = false }) => {
    // 要求降低動態時：停用自動輪播，換張改成立即切換（使用者仍可用左右箭頭手動切）
    const reducedMotion = useReducedMotion();
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

            {hasImages ? (
                /* 有圖版：左側輪播 + 右側列表 */
                <div className="event-container">
                    <div className="event-left">
                        <Swiper
                            modules={[Navigation, Autoplay, EffectFade]}
                            effect="fade"
                            speed={reducedMotion ? 0 : 800}
                            loop={withImage.length > 1}
                            navigation={true}
                            autoplay={reducedMotion ? false : { delay: 8000 }}
                            grabCursor={true}
                        >
                            {withImage.map((event) => (
                                <SwiperSlide key={event.id}>
                                    <div className="slide">
                                        <img src={event.image} alt={event.title} />
                                        <div className="slide-info">
                                            <div className="slide-date">
                                                {event.start_date}{event.end_date ? ` ～ ${event.end_date}` : ''}
                                            </div>
                                            <h3>{event.title}</h3>
                                            <a href={event.detail} target="_blank" rel="noreferrer">查看詳情 →</a>
                                        </div>
                                    </div>
                                </SwiperSlide>
                            ))}
                        </Swiper>
                    </div>

                    <div className="event-right">
                        <ul className="text-list">
                            {withoutImage.map((event) => (
                                <li key={event.id}>
                                    <a href={event.detail} className="text-item" target="_blank" rel="noreferrer">
                                        <div className="text-item-date">{event.start_date}</div>
                                        <div className="text-item-content">
                                            <span className="tag" data-tag={event.tag}>{event.tag}</span>
                                            <h4>{event.title}</h4>
                                        </div>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            ) : (
                /* 無圖版：卡片格狀排列 */
                <div className="news-card-grid">
                    {allNews.map((event) => (
                        <a
                            key={event.id}
                            href={event.detail}
                            className="news-card"
                            target="_blank"
                            rel="noreferrer"
                        >
                            <div className="news-card-top">
                                <span className="tag" data-tag={event.tag}>{event.tag}</span>
                                <span className="news-card-date">{event.start_date}</span>
                            </div>
                            <h4 className="news-card-title">{event.title}</h4>
                            <span className="news-card-link">查看詳情 →</span>
                        </a>
                    ))}
                </div>
            )}
        </section>
    );
};
export default News;