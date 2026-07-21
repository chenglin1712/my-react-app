import "../../static/css/_home/dateReminder.css";
import { useState, useEffect, useRef } from 'react';
import { Calendar, User, FileText, Award, Mail, Bell} from 'lucide-react';
import {
  Button, Spinner
} from 'react-bootstrap';

// phase（後端 /crawler/exam_schedule/ 回傳的簡短期程代稱）-> 圖示，純前端呈現用，
// 不影響資料本身；後端未對到的新期程名稱就沿用 FileText 當預設圖示。
const PHASE_ICONS = {
    報名: <User className="w-4 h-4" />,
    准考證: <Mail className="w-4 h-4" />,
    測驗: <FileText className="w-4 h-4" />,
    成績: <Calendar className="w-4 h-4" />,
    複查: <FileText className="w-4 h-4" />,
    成績單寄發: <Mail className="w-4 h-4" />,
    證書: <Award className="w-4 h-4" />,
};

const DateReminder = () => {
    const [examSchedule, setExamSchedule] = useState([]);
    const [sessionName, setSessionName] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [toastList, setToastList] = useState([]);
    const [dismissedPhases, setDismissedPhases] = useState(() => {
        const stored = localStorage.getItem("dismissedPhases");
        return stored ? JSON.parse(stored) : [];
    });
    const [doNotRemindMap, setDoNotRemindMap] = useState({});
    const notifiedRef = useRef({});

    // 考試時程改成向後端拿真實資料（爬官網日程表），取代原本寫死在前端、
    // 早就過期的假資料（見 backend/crawler/views.py 的 get_exam_schedule）。
    useEffect(() => {
        fetch(`${import.meta.env.VITE_API_EXAM_SCHEDULE_URL}`)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                const phases = (data.phases || []).map((p) => ({
                    phase: p.phase,
                    date: new Date(p.start_date),
                    endDate: p.end_date ? new Date(p.end_date) : undefined,
                    icon: PHASE_ICONS[p.phase] || <FileText className="w-4 h-4" />,
                }));
                setExamSchedule(phases);
                setSessionName(data.session || null);
            })
            .catch((err) => {
                console.error("載入考試時程失敗：", err);
                setError(true);
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 60000);
        return () => clearInterval(timer);
    }, []);

    const isToday = (someDate) => {
        const today = new Date();
        return (
            someDate.getFullYear() === today.getFullYear() &&
            someDate.getMonth() === today.getMonth() &&
            someDate.getDate() === today.getDate()
        );
    };

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
    }, [currentTime, dismissedPhases, examSchedule]);

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
                            <button className="close-btn" onClick={() => handleCloseToast(toast.phase)} aria-label="關閉">✕</button>
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

                {loading && (
                    <div className="text-center py-4">
                        <Spinner animation="border" size="sm" />
                        <p className="schedule-loading-text">時程載入中...</p>
                    </div>
                )}

                {!loading && error && (
                    <p className="schedule-error-text">目前無法載入考試時程，請稍後再試。</p>
                )}

                {!loading && !error && (
                    <>
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
                            <div className="schedule-title">
                                完整時程{sessionName ? `｜${sessionName.replace(/日程表$/, '')}` : ''}
                            </div>
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

                        <div className="note">※ 實際日期以原民會公告為準，資料每 15 分鐘自動更新</div>
                    </>
                )}
            </div>
        </div>
    );
};

export default DateReminder;
