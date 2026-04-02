import "../../static/css/_calendar/calendar_date.css"
import { useState, useEffect } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import { Trash2 } from "lucide-react";
import { getCalendar } from "../../src/userServives/uploadDb"
import { useNavigate } from "react-router-dom";

const UserCalendar = () => {
    const navigate = useNavigate();
    const [date, setDate] = useState(new Date());
    const [newEvent, setNewEvent] = useState("");
    const [eventsByDate, setEventsByDate] = useState({});

    const formattedDate = date.toLocaleDateString("zh-TW", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).split("/").join("-");
    const [selectedDateKey, setSelectedDateKey] = useState(
        new Date().toISOString().split("T")[0]
    );

    useEffect(() => {
        const fetchEvents = async () => {
            const data = await getCalendar();
            const grouped = {};
            data.forEach(event => {
                const dateKey = event.start.split("T")[0];
                if (!grouped[dateKey]) grouped[dateKey] = [];
                grouped[dateKey].push(event);
            });
            setEventsByDate(grouped);
        };
        fetchEvents();
    }, []);

    const handleDateChange = (selectedDate) => {
        setDate(selectedDate);
        setSelectedDateKey(selectedDate.toISOString().split("T")[0]);
    };

    const handleAddEvent = () => {
        if (!newEvent.trim()) return;

        const newEventObj = {
            summary: newEvent,
            description: "",
            start: `${formattedDate}T00:00:00+08:00`,
            end: `${formattedDate}T00:30:00+08:00`
        };

        const updated = {
            ...eventsByDate,
            [formattedDate]: [...(eventsByDate[formattedDate] || []), newEventObj]
        };

        setEventsByDate(updated);
        setNewEvent("");

        // TODO: 可以呼叫寫入 Firebase 的 API
    };

    const handleDelete = (index) => {
        const updatedDateEvents = [...(eventsByDate[formattedDate] || [])];
        updatedDateEvents.splice(index, 1);
        const updated = { ...eventsByDate, [formattedDate]: updatedDateEvents };
        setEventsByDate(updated);

        // TODO: 可以呼叫刪除事件 API
    };

    const eventsForDate = eventsByDate[formattedDate] || [];

    return (
        <div className="calendar-wrapper">
            <div className="calendar-left">
                <Calendar
                    onChange={handleDateChange}
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
                        const dateKey = date.toISOString().split("T")[0];
                        const isSelected = dateKey === selectedDateKey;
                        if (view === "month" && eventsByDate[dateKey]?.length > 0) {
                            return (
                                <div
                                    className="dot-indicator"
                                    style={{ backgroundColor: isSelected ? "white" : "#9b1b30" }}
                                />
                            );
                        }
                        return null;
                    }}
                />
            </div>
            <div className="calendar-right">
                <h2>{formattedDate} 的行程</h2>
                <div className="event-list-scroll">
                    {eventsForDate.map((event, index) => (
                        <div className="event-card" key={index}>
                            <h4>{event.summary}</h4>
                            <p>{event.description}</p>
                            <span>
                                {new Date(event.start).toLocaleTimeString()} -{" "}
                                {new Date(event.end).toLocaleTimeString()}
                            </span>
                            <button onClick={() => handleDelete(index)} title="刪除" className="delete-btn">
                                <Trash2 size={16} />
                            </button>
                            {/(測驗)/.test(event.summary + event.description) && (
                                <button
                                    className="go-quiz-btn"
                                    onClick={() => navigate('/quiz')}
                                >
                                    前往測驗
                                </button>
                            )}
                        </div>
                    ))}
                    {eventsForDate.length === 0 && <div className="no-event">尚無紀錄</div>}
                </div>

                <div className="event-input-bar">
                    <input
                        type="text"
                        placeholder="新增事件..."
                        value={newEvent}
                        onChange={(e) => setNewEvent(e.target.value)}
                        onKeyPress={(e) => {
                            if (e.key === "Enter") handleAddEvent();
                        }}
                    />
                    <button onClick={handleAddEvent}>新增</button>
                </div>
            </div>
        </div>
    );
};
export default UserCalendar;