import { useId } from "react";
import "../../static/css/_home/calendar.css";
import ExternalLink from "../ui/ExternalLink";
import { formatMonthDay, phaseStatus } from "./examScheduleContent";

/**
 * 族語認證時程（首頁第一屏的一欄）：報名、准考證、測驗、成績…每個期程一列，
 * 左邊是日期（或起訖日），右邊是期程名稱與狀態（已結束／進行中／還有幾天），報名與成績附前往頁面的連結。
 * 狀態一律用文字說明，不只靠顏色；目前進行中的期程左側有一條強調色。
 * schedule 是 pickExamSchedule() 整理過的資料；載入中、失敗（可重新載入）、沒有資料各有自己的畫面。
 * now 只給測試用，預設是現在。
 */
const CertificationSection = ({ schedule, loading = false, error = false, onRetry, now }) => {
    const titleId = useId();
    const today = now ?? new Date();
    const phases = schedule?.phases ?? [];
    // 第一個還沒開始的期程：狀態字用強調色，並附前往連結
    const nextIndex = phases.findIndex((item) => phaseStatus(item, today).state === "upcoming");

    const header = (
        <div className="exam-header">
            <h2 className="exam-title" id={titleId}>族語認證時程</h2>
            {schedule?.session && <p className="exam-session">{schedule.session}</p>}
        </div>
    );

    if (loading) {
        return (
            <section className="exam-section" aria-labelledby={titleId} aria-busy="true">
                {header}
                <div className="exam-skeleton" role="status">
                    <span className="visually-hidden">認證時程載入中…</span>
                    {[0, 1, 2].map((index) => (
                        <span className="yy-skeleton exam-skeleton__row" aria-hidden="true" key={index} />
                    ))}
                </div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="exam-section" aria-labelledby={titleId}>
                {header}
                <div className="exam-empty" role="alert">
                    <p>目前無法載入認證時程，請稍後再試。</p>
                    {onRetry && <button type="button" className="exam-retry" onClick={onRetry}>重新載入</button>}
                </div>
            </section>
        );
    }

    return (
        <section className="exam-section" aria-labelledby={titleId}>
            {header}
            {phases.length === 0 ? (
                <p className="exam-empty">目前沒有認證時程。</p>
            ) : (
                <>
                    <ul className="exam-list yy-stagger">
                        {phases.map((item, index) => {
                            const { state, daysLeft } = phaseStatus(item, today);
                            const statusText = state === "past" ? "已結束" : state === "current" ? "進行中" : daysLeft === 1 ? "明天開始" : `${daysLeft} 天後`;
                            // 連結只放在「進行中」與「下一個」期程上，已結束或還很久的不放，清單才不會每列都長一個連結
                            const showLink = item.url && (state === "current" || index === nextIndex);
                            return (
                                <li
                                    className="exam-card"
                                    data-state={state}
                                    data-next={index === nextIndex ? "true" : undefined}
                                    style={{ "--i": index }}
                                    key={`${item.phase}|${item.start.getTime()}`}
                                >
                                    <span className="exam-date">
                                        <span>{formatMonthDay(item.start)}</span>
                                        {item.end && <span className="exam-date__end">～{formatMonthDay(item.end)}</span>}
                                    </span>
                                    <div className="exam-body">
                                        <div className="exam-line">
                                            <p className="exam-item-title">{item.phase}</p>
                                            <span className="exam-status">{statusText}</span>
                                        </div>
                                        {showLink && (
                                            <ExternalLink href={item.url} className="exam-link">
                                                前往{item.phase}頁面 →
                                            </ExternalLink>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="exam-note">實際日期以原民會公告為準。</p>
                </>
            )}
        </section>
    );
};
export default CertificationSection;
