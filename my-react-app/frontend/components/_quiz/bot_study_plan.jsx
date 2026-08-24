import "../../static/css/_quiz/bot_study_plan.css"
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Alert } from "react-bootstrap";
import successAnimation from "../../src/animations/success.json"
import { useLottieAnimation } from "../../hooks/useLottieAnimation";
import { addCalendarEvent, addCalendarEvents } from "../../src/userServives/uploadDb";

function CalendarPlusIcon() {
    return (
        <svg className="calendar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <line x1="12" y1="14" x2="12" y2="18" />
            <line x1="10" y1="16" x2="14" y2="16" />
        </svg>
    );
}

function toCalendarEvent(event) {
    return {
        summary: event.summary,
        description: event.description || "",
        start: event.start,
        end: event.end,
    };
}

const StudyPlan = ({ plan, onClose }) => {
    const navigate = useNavigate();
    // 原本這裡有一份完全沒被讀取、沒有顯示、也沒有存起來的本地 events state，
    // 「加入」「全部加入」實際上什麼都沒發生，卻在「全部加入」之後顯示
    // 「成功加入行事曆!」的動畫——使用者會被明確告知成功，但真正的行事曆頁面
    // 什麼都不會有。改成真的呼叫 addCalendarEvent／addCalendarEvents 寫入
    // Firestore，寫入成功才顯示成功動畫。
    //
    // isSaving 讓「單筆加入」跟「全部加入」互相排斥、也不能同時觸發兩次：
    // addCalendarEvent／addCalendarEvents 都是「整包讀出現有事件、加上新的、
    // 整包寫回」，同時有兩個呼叫在進行中，各自讀到的「現有事件」不包含對方
    // 還沒寫回的那筆，寫回時會互相覆蓋、遺失更新。
    const [isSaving, setIsSaving] = useState(false);
    const [addedIndexes, setAddedIndexes] = useState(new Set());
    const [showSuccess, setShowSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");
    const animationRef = useLottieAnimation({
        animationData: successAnimation,
        enabled: showSuccess,
        loop: false,
        onComplete: () => setShowSuccess(false),
    });

    const handleAddToCalendar = async (event, index) => {
        if (isSaving) return;
        setErrorMsg("");
        setIsSaving(true);
        try {
            await addCalendarEvent(toCalendarEvent(event));
            setAddedIndexes((prev) => new Set([...prev, index]));
        } catch (error) {
            console.error("加入行事曆失敗:", error);
            setErrorMsg("加入行事曆失敗，請稍後再試。");
        } finally {
            setIsSaving(false);
        }
    };

    const handleAddAllToCalendar = async () => {
        if (isSaving) return;
        setErrorMsg("");

        const pendingIndexes = plan.events
            .map((_, index) => index)
            .filter((index) => !addedIndexes.has(index));
        if (pendingIndexes.length === 0) return;

        setIsSaving(true);
        try {
            await addCalendarEvents(pendingIndexes.map((index) => toCalendarEvent(plan.events[index])));
            setAddedIndexes((prev) => new Set([...prev, ...pendingIndexes]));
            setShowSuccess(true);
        } catch (error) {
            console.error("加入行事曆失敗:", error);
            setErrorMsg("加入行事曆失敗，請稍後再試。");
        } finally {
            setIsSaving(false);
        }
    };

    const formatDateTime = (dateString) => {
        const date = new Date(dateString);
        const options = {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        };
        return date.toLocaleString('zh-TW', options);
    };

    const formatTime = (dateString) => {
        return new Date(dateString).toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    };

    //確認日期是星期幾
    const getDayOfWeek = (dateString) => {
        const date = new Date(dateString);
        const days = ['日', '一', '二', '三', '四', '五', '六'];
        return `星期${days[date.getDay()]}`;
    };

    if (!plan || !plan.events || plan.events.length === 0) {
        return null;
    }

    const allAdded = plan.events.every((_, index) => addedIndexes.has(index));

    return (
        <>
            {showSuccess && (
                <div className="bot-animation-overlay">
                    <div className="bot-animation-container">
                        <div ref={animationRef} />
                        <p>成功加入行事曆!</p>
                    </div>
                </div>
            )}

            <div className="study-plan-container">
                <div className="study-plan-header">
                    <div className="header-left">
                        <h2 className="study-plan-title">{plan.title || "您的讀書計畫"}</h2>
                        <span className="event-count">{plan.events.length} 個學習活動</span>
                    </div>
                    <div className="header-buttons">
                        <button
                            type="button"
                            className="add-all-btn"
                            onClick={handleAddAllToCalendar}
                            disabled={isSaving || allAdded}
                        >
                            <CalendarPlusIcon />
                            {isSaving ? "加入中..." : allAdded ? "已全部加入" : "全部加入"}
                        </button>
                        <button
                            type="button"
                            className="view-calendar-btn"
                            onClick={() => {
                                onClose?.();
                                navigate("/calendar");
                            }}
                        >
                            <ExternalLink size={20} />
                            前往行事曆
                        </button>
                    </div>
                </div>

                {errorMsg && <Alert variant="danger" className="py-2" role="alert">{errorMsg}</Alert>}

                <div className="study-plan-list">
                    {plan.events.map((event, index) => {
                        const isAdded = addedIndexes.has(index);
                        return (
                            <div key={index} className="study-plan-card">
                                <div className="card-left">
                                    <div className="event-number">{index + 1}</div>
                                    <div className="event-info">
                                        <h3 className="event-title">{event.summary}</h3>
                                        <p className="event-description">{event.description}</p>
                                        <div className="event-time">
                                            <span className="day-badge">{getDayOfWeek(event.start)}</span>
                                            <span className="time-text">
                                                {formatDateTime(event.start)} - {formatTime(event.end)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="add-to-calendar-btn"
                                    onClick={() => handleAddToCalendar(event, index)}
                                    disabled={isAdded || isSaving}
                                >
                                    <CalendarPlusIcon />
                                    {isAdded ? "已加入" : "加入"}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </>
    );
};
export default StudyPlan;
