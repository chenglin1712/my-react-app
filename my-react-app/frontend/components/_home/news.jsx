import "../../static/css/_home/news.css"
import { Swiper, SwiperSlide } from "swiper/react"
import { Navigation, Autoplay, EffectFade } from "swiper/modules"
import "swiper/css"
import "swiper/css/effect-fade"
import "swiper/css/navigation";

const News = ({ withImage, withoutImage }) => {
    return (
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
                                        {event.start_date}{event.end_date ? ` - ${event.end_date}` : ''}
                                    </div>
                                    <h3>{event.title}</h3>
                                    <a href={event.detail} target="_blank" rel="noreferrer">詳情</a>
                                </div>
                            </div>
                        </SwiperSlide>
                    ))}
                </Swiper>
            </div>

            <div className="event-right">
                <h2 className="news-title">活動消息</h2>
                <p className="news-subtitle">News</p>
                <ul className="text-list">
                    {withoutImage.map((event, index) => (
                        <li key={index}>
                            <a href={event.detail} className="text-item" target="_blank">
                                <div className="text-item-date">{event.start_date}</div>
                                <div className="text-item-content">
                                    <span
                                        className="tag"
                                        data-tag={event.tag || '未分類'}
                                    >
                                        {event.tag || '未分類'}
                                    </span>
                                    <h4>{event.title}</h4>
                                </div>
                            </a>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
export default News;