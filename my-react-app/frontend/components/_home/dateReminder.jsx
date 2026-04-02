import "../../static/css/_home/dateReminder.css";
import { useState, useEffect, useRef } from 'react';
import { Calendar, User, FileText, Award, Mail, Bell} from 'lucide-react';
import {
  Button
} from 'react-bootstrap';

const DateReminder = () => {
    const [currentTime, setCurrentTime] = useState(new Date());
    const [toastList, setToastList] = useState([]); 
    const [dismissedPhases, setDismissedPhases] = useState(() => {
        const stored = localStorage.getItem("dismissedPhases");
        return stored ? JSON.parse(stored) : [];
    });
    const [doNotRemindMap, setDoNotRemindMap] = useState();
    const notifiedRef = useRef();

    const examSchedule = [
        {
            phase: '報名',
            date: new Date('2025-09-12'),
            // date: new Date(),
            endDate: new Date('2025-10-03'),
            icon: <User className="w-4 h-4" />,
        },
        {
            phase: '准考證',
            date: new Date('2025-11-17'),
            icon: <Mail className="w-4 h-4" />,
        },
        {
            phase: '測驗',
            date: new Date('2025-12-06'),
            icon: <FileText className="w-4 h-4" />,
        },
        {
            phase: '成績',
            date: new Date('2026-02-13'),
            icon: <Calendar className="w-4 h-4" />,
        },
        {
            phase: '複查',
            date: new Date('2026-02-13'),
            endDate: new Date('2026-03-06'),
            icon: <FileText className="w-4 h-4" />,
        },
        {
            phase: '證書',
            date: new Date('2026-03-23'),
            icon: <Award className="w-4 h-4" />,
        }
    ];

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const newToasts = [];

        examSchedule.forEach(event => {
            if (
                isToday(event.date) &&
                !notifiedRef.current[event.phase] &&
                !dismissedPhases.includes(event.phase)
            ) {
                newToasts.push({
                    phase: event.phase,
                    url: event.phase === '報名'
                        ? 'https://exam.sce.ntnu.edu.tw/abst/signup/login.php'
                        : event.phase === '成績'
                            ? 'https://exam.sce.ntnu.edu.tw/abst/score_search.php'
                            : null
                });
                notifiedRef.current[event.phase] = true;
            }
        });

        if (newToasts.length > 0) {
            setToastList(prev => [...prev, ...newToasts]);
        }
    }, [currentTime, dismissedPhases]);

    const isToday = (someDate) => {
        const today = new Date();
        return (
            someDate.getFullYear() === today.getFullYear() &&
            someDate.getMonth() === today.getMonth() &&
            someDate.getDate() === today.getDate()
        );
    };

    const calculateDaysLeft = (targetDate) => {
        const difference = targetDate - currentTime;
        return difference > 0 ? Math.ceil(difference / (1000 * 60 * 60 * 24)) : 0;
    };

    const getNextEvent = () => {
        const futureEvents = examSchedule.filter(event => event.date > currentTime);
        return futureEvents.length > 0 ? futureEvents[0] : null;
    };

    const nextEvent = getNextEvent();

    const handleCloseToast = (phase) => {
        setToastList(prev => prev.filter(toast => toast.phase !== phase));

        if (doNotRemindMap[phase]) {
            const updated = [...dismissedPhases, phase];
            setDismissedPhases(updated);
            localStorage.setItem("dismissedPhases", JSON.stringify(updated));
        }

        setDoNotRemindMap(prev => {
            const newMap = { ...prev };
            delete newMap[phase];
            return newMap;
        });
    };

    const handleToggleRemind = (phase, checked) => {
        setDoNotRemindMap(prev => ({
            ...prev,
            [phase]: checked
        }));
    };

    const handleResetNotifications = () => {
        localStorage.removeItem("dismissedPhases");
        setDismissedPhases([]);
        setToastList([]); 
        notifiedRef.current = {};
    };

    return (
        <div className="exam-info-card">
            <div className="circle top-right"></div>
            <div className="circle bottom-left"></div>

            <div className="content">
                <div className="reset-reminders">
                    <Button variant="outline-danger" onClick={handleResetNotifications}><Bell /> 開啟通知</Button>
                </div>

                {toastList.map((toast) => (
                    <div className="toast-notification" key={toast.phase}>
                        <div className="toast-header">
                            📢 {toast.phase} 今日開始！
                            <button className="close-btn" onClick={() => handleCloseToast(toast.phase)}>✕</button>
                        </div>
                        <div className="toast-body">
                            {toast.url ? (
                                <a href={toast.url} target="_blank" rel="noopener noreferrer" className="toast-link">
                                    點我前往 {toast.phase} 頁面
                                </a>
                            ) : (
                                <p>請注意 {toast.phase} 的相關事宜！</p>
                            )}
                            <div className="dismiss-option">
                                <label className="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={!!doNotRemindMap[toast.phase]}
                                        onChange={(e) => handleToggleRemind(toast.phase, e.target.checked)}
                                    />
                                    不再提醒此項目
                                </label>
                            </div>
                        </div>
                    </div>
                ))}

                {nextEvent && (
                    <div className="text-center mb-4">
                        <div className="event-head">
                            {nextEvent.icon}
                            <span className="text-lg font-semibold">{nextEvent.phase}</span>
                        </div>

                        <div className="countdown-box">
                            <div className="days-left">{calculateDaysLeft(nextEvent.date)}</div>
                            <div className="days-label">天後</div>
                        </div>

                        <div className="date-range">
                            {nextEvent.endDate
                                ? `${nextEvent.date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} - ${nextEvent.endDate.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}`
                                : nextEvent.date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}
                        </div>
                    </div>
                )}

                <div className="schedule">
                    <div className="schedule-title">完整時程</div>
                    <div className="schedule-grid">
                        {examSchedule.map((event, index) => {
                            const daysLeft = calculateDaysLeft(event.date);
                            const isPast = event.date < currentTime;
                            const isCurrent = nextEvent && event.phase === nextEvent.phase;

                            return (
                                <div
                                    key={index}
                                    className={`schedule-item ${isCurrent
                                        ? "current"
                                        : isPast
                                            ? "past"
                                            : "upcoming"
                                        }`}
                                >
                                    <div className="icon">{event.icon}</div>
                                    <div className="phase">{event.phase}</div>
                                    <div className="date">
                                        {event.date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' })}
                                    </div>
                                    {!isPast && (
                                        <div className="days">{daysLeft > 0 ? `${daysLeft}天` : '今日'}</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="note">※ 實際日期以原民會公告為準</div>
            </div>
        </div>
    );
};

export default DateReminder;
