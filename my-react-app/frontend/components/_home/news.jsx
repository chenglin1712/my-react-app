import "../../static/css/_home/news.css"
import { Swiper, SwiperSlide } from "swiper/react"
import { Navigation, Autoplay, EffectFade } from "swiper/modules"
import "swiper/css"
import "swiper/css/effect-fade"
import "swiper/css/navigation";

const News = ({ withImage, withoutImage }) => {
    const allNews = [...withImage, ...withoutImage];
    const hasImages = withImage.length > 0;

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
                            speed={800}
                            loop={withImage.length > 1}
                            navigation={true}
                            autoplay={{ delay: 8000 }}
                            grabCursor={true}
                        >
                            {withImage.map((event, index) => (
                                <SwiperSlide key={index}>
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
                            {withoutImage.map((event, index) => (
                                <li key={index}>
                                    <a href={event.detail} className="text-item" target="_blank" rel="noreferrer">
                                        <div className="text-item-date">{event.start_date}</div>
                                        <div className="text-item-content">
                                            <span className="tag" data-tag={event.tag || '活動'}>{event.tag || '活動'}</span>
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
                    {allNews.map((event, index) => (
                        <a
                            key={index}
                            href={event.detail}
                            className="news-card"
                            target="_blank"
                            rel="noreferrer"
                        >
                            <div className="news-card-top">
                                <span className="tag" data-tag={event.tag || '最新消息'}>{event.tag || '最新消息'}</span>
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