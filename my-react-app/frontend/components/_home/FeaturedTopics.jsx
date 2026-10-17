import { useState } from "react";
import { Link } from "react-router-dom";
import "../../static/css/_home/featuredTopics.css";

/**
 * 首頁「本期專題」（S7-1）：最多三張，一大兩小。
 * 沒有專題就不輸出任何元素（含標題）；只有一或兩張時依張數換版面，不放空卡。
 * 標題是整張卡的連結（伸展到整張卡可點），圖片只是裝飾，alt 留空。
 */
const TopicCard = ({ topic, featured }) => {
    // 圖片載入失敗就退回純文字卡，不留破圖與空框
    const [imageFailed, setImageFailed] = useState(false);
    const showImage = topic.imageUrl && !imageFailed;
    const { link } = topic;

    const title = link?.external ? (
        <a className="topic-link" href={link.href} target="_blank" rel="noopener noreferrer">
            {topic.title}
            <span className="visually-hidden">（另開新視窗）</span>
        </a>
    ) : link ? (
        <Link className="topic-link" to={link.href}>{topic.title}</Link>
    ) : (
        topic.title
    );

    return (
        <li className={`topic-card${featured ? " topic-card--lead" : ""}${showImage ? "" : " topic-card--text"}`}>
            {showImage && (
                <img
                    className="topic-image"
                    src={topic.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setImageFailed(true)}
                />
            )}
            <div className="topic-body">
                {topic.categoryLabel && <span className="topic-tag">{topic.categoryLabel}</span>}
                <h3 className={`topic-title${link ? " topic-title--linked" : ""}`}>{title}</h3>
                {topic.summary && <p className="topic-summary">{topic.summary}</p>}
            </div>
        </li>
    );
};

const MAX_TOPICS = 3;

const FeaturedTopics = ({ topics: allTopics }) => {
    // 正規化（pickFeaturedTopics）已經限制三張，這裡再守一次，版面只有一到三張的樣式
    const topics = Array.isArray(allTopics) ? allTopics.slice(0, MAX_TOPICS) : [];
    if (topics.length === 0) return null;

    return (
        <section className="topics-section" aria-labelledby="topics-heading">
            <div className="topics-header">
                <h2 className="topics-heading" id="topics-heading">本期專題</h2>
            </div>
            <ul className={`topics-grid topics-grid--${topics.length}`}>
                {topics.map((topic, index) => (
                    // 圖片網址參與 key：換了新圖就重新嘗試載入，不會沿用上一張圖「載入失敗」的狀態
                    <TopicCard key={`${index}|${topic.key}|${topic.imageUrl}`} topic={topic} featured={index === 0 && topics.length > 1} />
                ))}
            </ul>
        </section>
    );
};

export default FeaturedTopics;
