import "../../static/css/_calendar/calendar_date.css"
import { useState, useEffect } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { Trash2 } from "lucide-react";
import { getCalendar, addCalendarEvent, deleteCalendarEvent } from "../../src/userServives/uploadDb"
import { useNavigate } from "react-router-dom";
import { confirmAction } from "@components/ui/ConfirmDialog";
import {
    EVENT_TYPE_GENERAL,
    EVENT_TYPE_QUIZ,
    buildEventRange,
    formatEventTime,
    getEventType,
} from "@utils/calendarEvents";

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

    const dateKey = toLocalDateKey(date);

    useEffect(() => {
        let cancelled = false;
        const fetchEvents = async () => {
            try {
                const data = await getCalendar();
                if (cancelled) return;
                const grouped = {};
                (data || []).forEach(event => {
                    const key = event.start.split("T")[0];
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(event);
                });
                setEventsByDate(grouped);
            } catch (err) {
                if (!cancelled) {
                    console.error("載入行事曆失敗：", err);
                    setError("載入行事曆失敗，請稍後再試。");
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        fetchEvents();
        return () => { cancelled = true; };
    }, []);

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
            setError("新增行程失敗，請稍後再試。");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (event) => {
        const eventId = event.id;
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
            await deleteCalendarEvent(eventId);
            setEventsByDate(prev => ({
                ...prev,
                [dateKey]: (prev[dateKey] || []).filter(e => e.id !== eventId),
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
                        if (view === "month" && eventsByDate[key]?.length > 0) {
                            return (
                                <div
                                    className="dot-indicator"
                                    style={{ backgroundColor: isSelected ? "white" : "var(--yy-red)" }}
                                />
                            );
                        }
                        return null;
                    }}
                />
            </div>
            <div className="calendar-right">
                <h2>{formatChineseDate(date)} 的行程</h2>
                {error && <p className="calendar-error-text" role="alert">{error}</p>}
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
                    {!isLoading && eventsForDate.length === 0 && <div className="no-event">尚無紀錄</div>}
                </div>

                <form className="event-input-bar" onSubmit={handleAddEvent}>
                    <input
                        type="text"
                        placeholder="新增事件..."
                        value={newEvent}
                        onChange={(e) => setNewEvent(e.target.value)}
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
