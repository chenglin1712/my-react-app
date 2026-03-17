import "../../static/css/_quiz/bot_study_plan.css"
import { useState, useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import lottie from 'lottie-web';
import successAnimation from "../../src/animations/success.json"

const studyPlan = ({ plan, onClose }) => {
    const navigate = useNavigate();
    const [events, setEvents] = useState({});
    const animation = useRef(null);
    const [showSuccess, setShowSuccess] = useState(false);

    if (!plan || !plan.events || plan.events.length === 0) {
        return null;
    }
    //單一事件加入行事曆
    const handleAddToCalendar = async (event) => {
        try {
            const date = event.start.split('T')[0];

            const startTime = new Date(event.start).toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            const endTime = new Date(event.end).toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });

            const eventText = `${startTime}-${endTime} ${event.summary}`;
            setEvents((prev) => ({
                ...prev,
                [date]: [...(prev[date] || []), eventText],
            }));

        } catch (error) {
            console.error("加入行事曆失敗:", error);
            alert("加入行事曆失敗");
        }
    };
    //全部加入行事曆
    const handleAddAllToCalendar = async () => {
        try {
            const newEvents = { ...events };

            plan.events.forEach(event => {
                const date = event.start.split('T')[0];

                const startTime = new Date(event.start).toLocaleTimeString('zh-TW', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                const endTime = new Date(event.end).toLocaleTimeString('zh-TW', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });

                const eventText = `${startTime}-${endTime} ${event.summary}`;

                if (!newEvents[date]) {
                    newEvents[date] = [];
                }
                newEvents[date].push(eventText);
            });

            setEvents(newEvents);

            setTimeout(() => {
                setShowSuccess(true);
                setTimeout(() => setShowSuccess(false), 2000);
            }, 1000);
        } catch (error) {
            console.error("加入行事曆失敗:", error);
            alert("加入行事曆失敗,請稍後再試。");
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

    //確認日期是星期幾
    const getDayOfWeek = (dateString) => {
        const date = new Date(dateString);
        const days = ['日', '一', '二', '三', '四', '五', '六'];
        return `星期${days[date.getDay()]}`;
    };

    useEffect(() => {
        if (showSuccess && animation.current) {
            const instance = lottie.loadAnimation({
                container: animation.current,
                renderer: 'svg',
                loop: false,
                autoplay: true,
                animationData: successAnimation,
            });
            return () => instance.destroy();
        }
    }, [showSuccess]);

    return (
        <>
            {showSuccess && (
                <div className="bot-animation-overlay">
                    <div className="bot-animation-container">
                        <div ref={animation} />
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
                            className="add-all-btn"
                            onClick={handleAddAllToCalendar}
                        >
                            <svg className="calendar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                <line x1="16" y1="2" x2="16" y2="6" />
                                <line x1="8" y1="2" x2="8" y2="6" />
                                <line x1="3" y1="10" x2="21" y2="10" />
                                <line x1="12" y1="14" x2="12" y2="18" />
                                <line x1="10" y1="16" x2="14" y2="16" />
                            </svg>
                            全部加入
                        </button>
                        <button
                            className="view-calendar-btn"
                            onClick={() => {
                                onClose();
                                navigate("/calendar");
                            }}
                        >
                            <ExternalLink size={20} />
                            前往行事曆
                        </button>
                    </div>
                </div>

                <div className="study-plan-list">
                    {plan.events.map((event, index) => (
                        <div key={index} className="study-plan-card">
                            <div className="card-left">
                                <div className="event-number">{index + 1}</div>
                                <div className="event-info">
                                    <h3 className="event-title">{event.summary}</h3>
                                    <p className="event-description">{event.description}</p>
                                    <div className="event-time">
                                        <span className="day-badge">{getDayOfWeek(event.start)}</span>
                                        <span className="time-text">
                                            {formatDateTime(event.start)} - {formatDateTime(event.end).split(' ')[1]}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button
                                className="add-to-calendar-btn"
                                onClick={() => handleAddToCalendar(event)}
                            >
                                <svg className="calendar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                    <line x1="12" y1="14" x2="12" y2="18" />
                                    <line x1="10" y1="16" x2="14" y2="16" />
                                </svg>
                                加入
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
};
export default studyPlan;