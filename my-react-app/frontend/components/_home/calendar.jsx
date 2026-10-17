import { useId, useState } from "react"
import "../../static/css/_home/calendar.css"
import ExternalLink from "../ui/ExternalLink"

// 首頁第一屏只放最新的幾則；其餘收在「顯示全部」，需要時再展開，不讓這一欄把第一屏撐得比其他欄長很多
const PREVIEW_COUNT = 5;

/**
 * 族語認證最新公告（首頁第一屏的一欄）。
 * 只負責公告清單；考試期程提醒（DateReminder）已拆出去，由首頁另外放（行事曆區塊的去留是決定 D5）。
 * 沒有公告、或公告載入失敗時（失敗時首頁傳進來的是空陣列），沿用原本的「目前沒有任何公告。」。
 */
const CertificationSection = ({ examInfo }) => {
    const [expanded, setExpanded] = useState(false);
    const titleId = useId();
    const listId = useId();
    // 資料不是陣列（null、載入前）視為沒有公告；沒有標題的項目沒東西可讀也沒東西可點，直接略過
    const items = Array.isArray(examInfo)
        ? examInfo.filter((item) => typeof item?.title === "string" && item.title.trim() !== "")
        : [];
    const canExpand = items.length > PREVIEW_COUNT;
    const visible = expanded || !canExpand ? items : items.slice(0, PREVIEW_COUNT);

    return (
        <section className="exam-section" aria-labelledby={titleId}>
            <div className="exam-header">
                <h2 className="exam-title" id={titleId}>族語認證最新公告</h2>
            </div>
            {items.length === 0 ? (
                <p className="exam-empty">目前沒有任何公告。</p>
            ) : (
                <>
                    <ul className="exam-list" id={listId}>
                        {visible.map((item) => (
                            <li className="exam-card" key={item.id}>
                                {item.start_date && <span className="exam-date">{item.start_date}</span>}
                                <ExternalLink href={item.detail} className="exam-link">
                                    {item.title}
                                </ExternalLink>
                            </li>
                        ))}
                    </ul>
                    {canExpand && (
                        <button
                            type="button"
                            className="exam-more"
                            aria-expanded={expanded}
                            aria-controls={listId}
                            onClick={() => setExpanded((open) => !open)}
                        >
                            {expanded ? "收合" : `顯示全部 ${items.length} 則`}
                        </button>
                    )}
                </>
            )}
        </section>
    );
};
export default CertificationSection;
