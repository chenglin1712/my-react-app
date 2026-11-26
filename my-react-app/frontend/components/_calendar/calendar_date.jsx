import "../../static/css/_calendar/calendar_date.css"
import { useState, useEffect } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { Trash2 } from "lucide-react";
import { getCalendar, addCalendarEvent, deleteCalendarEvent, CalendarFullError, CALENDAR_EVENT_LIMIT } from "../../src/userServives/uploadDb"
import { useNavigate } from "react-router-dom";
import { confirmAction } from "@components/ui/ConfirmDialog";
import {
    EVENT_TYPE_GENERAL,
    EVENT_TYPE_QUIZ,
    buildEventRange,
    formatEventTime,
    getEventType,
} from "@utils/calendarEvents";
import { groupEventsByDate } from "./eventDateKey";

// 事件名稱長度上限（稽核 FE6-12）：原本沒有任何限制，一筆超長文字就能讓整份行事曆文件逼近 1 MiB。
// 比照讀書計畫 summary 的上限。
const EVENT_SUMMARY_MAX_LENGTH = 100;

// 本地日期 key（YYYY-MM-DD）。原本同時用 toLocaleDateString().split("/").join("-")
// 和 toISOString().split("T")[0] 兩種方式產生日期 key：後者是 UTC，跟使用者
// 操作的本地時間（UTC+8）不一致——每天凌晨 0~8 點之間，toISOString() 算出來的
// 日期會是前一天，導致當天新增的事件在行事曆上跟圓點標記/選中狀態對不上。
// 這裡統一用本地年月日組字串，兩邊都吃同一個結果。
function toLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// 標題用中文日期（例如「10月14日 星期三」），不是 ISO 的 2026-10-14
function formatChineseDate(date) {
    return date.toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" });
}

const UserCalendar = () => {
    const navigate = useNavigate();
    const [date, setDate] = useState(new Date());
    const [newEvent, setNewEvent] = useState("");
    const [eventsByDate, setEventsByDate] = useState({});
    const [newEventTime, setNewEventTime] = useState("");
    const [newEventType, setNewEventType] = useState(EVENT_TYPE_GENERAL);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");
    // 稽核 FE6-11／FE1-23：讀取失敗跟新增／刪除失敗分開記，讀取失敗時不顯示「尚無紀錄」並提供重試
    const [loadError, setLoadError] = useState("");
    const [reloadToken, setReloadToken] = useState(0);

    const dateKey = toLocalDateKey(date);

    useEffect(() => {
        let cancelled = false;
        const fetchEvents = async () => {
            setIsLoading(true);
            setLoadError("");
            try {
                const data = await getCalendar();
                if (cancelled) return;
                // 稽核 FE6-14：用台灣時間解析日期；單筆格式錯誤只略過那一筆，不讓整份載入失敗
                const { grouped, skipped } = groupEventsByDate(data);
                if (skipped.length > 0) console.warn("行事曆有無法判斷日期的行程，已略過：", skipped);
                setEventsByDate(grouped);
            } catch (err) {
                if (!cancelled) {
                    console.error("載入行事曆失敗：", err);
                    setLoadError("載入行事曆失敗，請稍後再試。");
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchEvents();
        return () => { cancelled = true; };
    }, [reloadToken]);

    const handleAddEvent = async (e) => {
        e.preventDefault();
        if (!newEvent.trim()) return;
        setError("");
        setIsSaving(true);

        const newEventObj = {
            summary: newEvent.trim(),
            description: "",
            ...buildEventRange(dateKey, newEventTime),
            type: newEventType,
        };

        try {
            const saved = await addCalendarEvent(newEventObj);
            setEventsByDate(prev => ({
                ...prev,
                [dateKey]: [...(prev[dateKey] || []), saved],
            }));
            setNewEvent("");
            setNewEventTime("");
            setNewEventType(EVENT_TYPE_GENERAL);
        } catch (err) {
            console.error("新增行程失敗：", err);
            setError(
                err instanceof CalendarFullError
                    ? `行事曆已滿 ${CALENDAR_EVENT_LIMIT} 筆，請先刪除舊行程後再新增。`
                    : "新增行程失敗，請稍後再試。",
            );
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (event) => {
        // 刪除沒有復原，先確認，並說明刪的是哪一筆
        const confirmed = await confirmAction({
            title: "刪除這個行程？",
            message: <p className="mb-0">「{event.summary}」刪除後無法復原。</p>,
            confirmLabel: "刪除",
            cancelLabel: "保留",
        });
        if (!confirmed) return;
        setError("");
        try {
            // 稽核 FE6-04：有 id 傳 id；沒有 id 的舊行程傳整個物件讓服務層依內容只刪那一筆。
            // 畫面也只移除這一筆（用物件參照比對），不能用 e.id !== undefined 把當天所有舊行程一起濾掉。
            await deleteCalendarEvent(event.id ? event.id : event);
            setEventsByDate(prev => ({
                ...prev,
                [dateKey]: (prev[dateKey] || []).filter(e => (event.id ? e.id !== event.id : e !== event)),
            }));
        } catch (err) {
            console.error("刪除行程失敗：", err);
            setError("刪除行程失敗，請稍後再試。");
        }
    };

    const eventsForDate = eventsByDate[dateKey] || [];

    return (
        <div className="calendar-page">
        <h1 className="calendar-title">行事曆</h1>
        <div className="calendar-wrapper">
            <div className="calendar-left" aria-busy={isLoading}>
                <Calendar
                    onChange={setDate}
                    value={date}
                    locale="zh-TW"
                    calendarType="gregory"
                    formatDay={(locale, date) => date.getDate().toString()}
                    tileClassName={({ date, view }) =>
                        view === "month" && date.toDateString() === new Date().toDateString()
                            ? "today"
                            : null
                    }
                    tileContent={({ date, view }) => {
                        const key = toLocalDateKey(date);
                        const isSelected = key === dateKey;
                        const count = eventsByDate[key]?.length ?? 0;
                        if (view === "month" && count > 0) {
                            // 稽核 FE6-13：原本只有顏色圓點，報讀器讀不到。圓點本身標 aria-hidden，
                            // 另放視覺隱藏文字，讓日期按鈕的可存取名稱變成「11月5日，有 2 個行程」。
                            return (
                                <>
                                    <div
                                        className="dot-indicator"
                                        aria-hidden="true"
                                        style={{ backgroundColor: isSelected ? "white" : "var(--yy-red)" }}
                                    />
                                    <span className="visually-hidden">，有 {count} 個行程</span>
                                </>
                            );
                        }
                        return null;
                    }}
                />
            </div>
            <div className="calendar-right">
                <h2>{formatChineseDate(date)} 的行程</h2>
                {error && <p className="calendar-error-text" role="alert">{error}</p>}
                {!isLoading && loadError && (
                    <div className="calendar-error-text" role="alert">
                        <p className="mb-1">{loadError}</p>
                        <button type="button" className="calendar-retry-btn" onClick={() => setReloadToken((n) => n + 1)}>
                            重試
                        </button>
                    </div>
                )}
                <div className="event-list-scroll">
                    {isLoading && <div className="no-event" role="status">載入行程中…</div>}
                    {!isLoading && eventsForDate.map((event, index) => (
                        <div className="event-card" key={event.id ?? `${dateKey}-${index}`}>
                            <h4>{event.summary}</h4>
                            <p>{event.description}</p>
                            <span>
                                {formatEventTime(event)}
                            </span>
                            <button type="button" onClick={() => handleDelete(event)} title="刪除" className="delete-btn" aria-label={`刪除「${event.summary}」`}>
                                <Trash2 size={16} />
                            </button>
                            {getEventType(event) === EVENT_TYPE_QUIZ && (
                                <button
                                    type="button"
                                    className="go-quiz-btn"
                                    onClick={() => navigate('/quiz/select')}
                                >
                                    前往測驗
                                </button>
                            )}
                        </div>
                    ))}
                    {!isLoading && !loadError && eventsForDate.length === 0 && <div className="no-event">尚無紀錄</div>}
                </div>

                <form className="event-input-bar" onSubmit={handleAddEvent}>
                    <input
                        type="text"
                        placeholder="新增事件..."
                        value={newEvent}
                        onChange={(e) => setNewEvent(e.target.value)}
                        maxLength={EVENT_SUMMARY_MAX_LENGTH}
                        aria-label="新增事件"
                    />
                    <input
                        type="time"
                        value={newEventTime}
                        onChange={(e) => setNewEventTime(e.target.value)}
                        aria-label="時間（不填就是全天）"
                    />
                    <select
                        value={newEventType}
                        onChange={(e) => setNewEventType(e.target.value)}
                        aria-label="事件類型"
                    >
                        <option value={EVENT_TYPE_GENERAL}>一般行程</option>
                        <option value={EVENT_TYPE_QUIZ}>測驗提醒</option>
                    </select>
                    <button type="submit" disabled={isSaving}>{isSaving ? "新增中..." : "新增"}</button>
                </form>
            </div>
        </div>
        </div>
    );
};
export default UserCalendar;
