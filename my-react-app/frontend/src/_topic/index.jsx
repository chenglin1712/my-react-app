import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import RichTextRenderer from "../../components/_topic/RichTextRenderer";
import { formatArticleDate } from "../../components/_topic/richText";
import { SITE_NAME } from "../routeMeta";
import "../../static/css/_topic/index.css";

// 本期專題文章頁：首頁專題卡片點進來看到的內容，不用登入。
// 讀 /adminapi/public/featured-topics/<id>/；只有「已發布且有內文」的專題讀得到，其餘是 404。
const TopicPage = () => {
    const { id } = useParams();
    const [topic, setTopic] = useState(null);
    // loading / ready / missing（404）/ error（其他失敗，可重試）
    const [state, setState] = useState("loading");
    const [reloadKey, setReloadKey] = useState(0);
    const [imageFailed, setImageFailed] = useState(false);

    useEffect(() => {
        let active = true;
        // 換文章或離開頁面時取消還在跑的舊請求，不只是丟掉結果
        const controller = new AbortController();
        setState("loading");
        setImageFailed(false);
        fetch(`/adminapi/public/featured-topics/${encodeURIComponent(id)}/`, { signal: controller.signal })
            .then((res) => {
                if (res.status === 404) return null;
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (!active) return;
                setTopic(data);
                setState(data ? "ready" : "missing");
            })
            .catch((err) => {
                if (!active) return;
                console.error("載入專題失敗：", err);
                setState("error");
            });
        return () => { active = false; controller.abort(); };
    }, [id, reloadKey]);

    // 分頁標題跟著文章走（路由規則只知道「本期專題」）
    useEffect(() => {
        if (state === "ready" && topic?.title) document.title = `${topic.title}｜${SITE_NAME}`;
    }, [state, topic]);

    const retry = useCallback(() => setReloadKey((n) => n + 1), []);

    if (state === "loading") {
        return (
            <div className="yy-page tpage-page" aria-busy="true">
                <div className="tpage-skeleton" aria-hidden="true">
                    <span className="yy-skeleton tpage-skeleton__line tpage-skeleton__line--short" />
                    <span className="yy-skeleton tpage-skeleton__line tpage-skeleton__line--title" />
                    <span className="yy-skeleton tpage-skeleton__image" />
                    {[0, 1, 2, 3].map((i) => <span className="yy-skeleton tpage-skeleton__line" key={i} />)}
                </div>
                <p className="visually-hidden" role="status">載入中…</p>
            </div>
        );
    }

    if (state !== "ready") {
        return (
            <div className="yy-page tpage-page">
                <div className="tpage-state" role={state === "error" ? "alert" : undefined}>
                    <h1 className="tpage-state__title">{state === "missing" ? "找不到這篇專題" : "目前無法載入專題"}</h1>
                    <p>{state === "missing" ? "這篇專題可能已下架，或網址不正確。" : "請稍後再試。"}</p>
                    <div className="tpage-state__actions">
                        {state === "error" && <button type="button" className="tpage-btn" onClick={retry}>重新載入</button>}
                        <Link className="tpage-btn tpage-btn--ghost" to="/">回首頁</Link>
                    </div>
                </div>
            </div>
        );
    }

    const date = formatArticleDate(topic.published_at);
    const showImage = topic.image_url && !imageFailed;

    return (
        <div className="yy-page tpage-page">
            <article className="tpage-article">
                <header className="tpage-head">
                    <Link className="tpage-back" to="/">← 回首頁</Link>
                    {topic.category_label && <span className="tpage-kicker">{topic.category_label}</span>}
                    <h1 className="tpage-title">{topic.title}</h1>
                    {topic.summary && <p className="tpage-lede">{topic.summary}</p>}
                    {(topic.source_label || date) && (
                        <p className="tpage-byline">
                            {topic.source_label && <span>{topic.source_label}</span>}
                            {date && <time dateTime={topic.published_at}>{date}</time>}
                        </p>
                    )}
                </header>

                {showImage && (
                    <figure className="tpage-figure">
                        <img src={topic.image_url} alt="" decoding="async" onError={() => setImageFailed(true)} />
                        {topic.image_caption && <figcaption>{topic.image_caption}</figcaption>}
                    </figure>
                )}

                <div className="tpage-body">
                    <RichTextRenderer doc={topic.content} />
                </div>

                <footer className="tpage-foot">
                    <Link className="tpage-btn tpage-btn--ghost" to="/">← 回首頁看其他專題</Link>
                </footer>
            </article>
        </div>
    );
};

export default TopicPage;
