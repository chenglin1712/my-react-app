import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ExternalLink from "../../components/ui/ExternalLink";
import { mapAnnouncementToNewsItem } from "../../components/_home/announcementContent";
import "../../static/css/_home/news.css";
import "../../static/css/_announcements/index.css";

// 所有公告頁：不用登入。依發布時間由新到舊，可依分類篩選，一次載入 20 則，按「載入更多」再接著載。
const PAGE_SIZE = 20;
const CATEGORIES = [
    { value: "", label: "全部" },
    { value: "announcement", label: "公告" },
    { value: "activity", label: "活動" },
    { value: "exam", label: "考試" },
    { value: "maintenance", label: "系統維護" },
];

const AnnouncementsPage = () => {
    const [category, setCategory] = useState("");
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    // loading：第一頁載入中（顯示骨架）；loadingMore：接續載入中（按鈕變成載入中）
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    // 換分類或重新載入時，舊請求回來的資料要丟掉：每次請求記下序號，只有最新的序號能寫入畫面
    const requestRef = useRef(0);
    // 下一頁從伺服器清單的第幾筆開始：累計「伺服器已回傳的筆數」，不是畫面上的筆數。
    // 翻頁期間若有新公告插進來，下一頁開頭會和上一頁尾端重疊；重疊的會被濾掉，但伺服器位置仍要照實往前推，
    // 不能用 items.length，否則會一直重打同一段。
    const consumedRef = useRef(0);
    const loadingMoreRef = useRef(false);

    const fetchPage = useCallback((offset, append) => {
        const requestId = ++requestRef.current;
        const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (category) query.set("category", category);
        return fetch(`/adminapi/public/announcements/?${query}`)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (requestId !== requestRef.current) return;
                const raw = data.results ?? [];
                const next = raw.map(mapAnnouncementToNewsItem);
                consumedRef.current = (append ? consumedRef.current : 0) + raw.length;
                setItems((prev) => {
                    if (!append) return next;
                    const seen = new Set(prev.map((p) => p.id));
                    return [...prev, ...next.filter((n) => !seen.has(n.id))];
                });
                setTotal(typeof data.count === "number" ? data.count : offset + next.length);
                setError(false);
            })
            .catch((err) => {
                if (requestId !== requestRef.current) return;
                console.error("載入公告失敗：", err);
                setError(true);
            })
            .finally(() => {
                if (requestId !== requestRef.current) return;
                loadingMoreRef.current = false;
                setLoading(false);
                setLoadingMore(false);
            });
    }, [category]);

    // 換分類、按重新載入：回到第一頁
    useEffect(() => {
        loadingMoreRef.current = false;
        consumedRef.current = 0;
        setLoading(true);
        setLoadingMore(false);
        setError(false);
        fetchPage(0, false);
        return () => { requestRef.current += 1; };
    }, [fetchPage, reloadKey]);

    const loadMore = () => {
        // 同步的防重入：連按兩下時，第二下在 state 更新前就進來，只靠 disabled 擋不住
        if (loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
        setError(false);
        fetchPage(consumedRef.current, true);
    };

    const remaining = Math.max(0, total - items.length);
    const activeLabel = CATEGORIES.find((c) => c.value === category)?.label ?? "全部";

    return (
        <div className="yy-page ann-page">
            <header className="ann-head">
                <Link className="ann-back" to="/">← 回首頁</Link>
                <h1 className="ann-title">最新公告</h1>
                <p className="ann-lede">平台公告、活動與考試消息，新的在前面。</p>
            </header>

            <div className="ann-filter" role="group" aria-label="公告分類">
                {CATEGORIES.map((c) => (
                    <button
                        key={c.value || "all"}
                        type="button"
                        className="ann-chip"
                        aria-pressed={category === c.value}
                        onClick={() => setCategory(c.value)}
                    >
                        {c.label}
                    </button>
                ))}
            </div>

            {/* 給報讀器：切換分類或載入更多後念出目前共幾則 */}
            <p className="ann-count" role="status" aria-live="polite">
                {loading ? "載入中…" : error && items.length === 0 ? "" : `${activeLabel}共 ${total} 則`}
            </p>

            {loading ? (
                <div className="ann-skeleton" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => <span className="yy-skeleton ann-skeleton__row" key={i} />)}
                </div>
            ) : error && items.length === 0 ? (
                <div className="ann-state" role="alert">
                    <p>目前無法載入公告，請稍後再試。</p>
                    <button type="button" className="ann-btn" onClick={() => setReloadKey((n) => n + 1)}>重新載入</button>
                </div>
            ) : items.length === 0 ? (
                <div className="ann-state">
                    <p>{category ? `「${activeLabel}」目前沒有公告。` : "目前沒有公告。"}</p>
                </div>
            ) : (
                <>
                    <ul className="ann-list">
                        {items.map((item) => (
                            <li key={item.id}>
                                <ExternalLink href={item.detail} as="div" className="ann-item">
                                    <span className="ann-item__meta">
                                        <span className="news-tag" data-tag={item.tag}>{item.tag}</span>
                                        <span className="ann-item__date">{item.start_date}</span>
                                    </span>
                                    <h2 className="ann-item__title">{item.title}</h2>
                                </ExternalLink>
                            </li>
                        ))}
                    </ul>

                    {error && (
                        <p className="ann-inline-error" role="alert">載入更多失敗，請再試一次。</p>
                    )}
                    {remaining > 0 && (
                        <div className="ann-more">
                            <button type="button" className="ann-btn" onClick={loadMore} disabled={loadingMore}>
                                {loadingMore ? "載入中…" : `載入更多（還有 ${remaining} 則）`}
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default AnnouncementsPage;
