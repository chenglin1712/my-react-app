import "../../static/css/_quiz/quiz_panel_submit.css"
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { CheckCircle, XCircle, Star } from "lucide-react"
import { getQuizSubmitById, countScore } from "../../src/userServives/uploadDb"

const Panel_Submit = ({ }) => {
    const navigate = useNavigate();
    const [isLoad, setIsLoad] = useState(true);

    const [data, setData] = useState(null);
    const [createdAt, setCreatedAt] = useState(null);
    const [duration, setDuration] = useState(null);
    const [score, setScore] = useState(0);

    const location = useLocation();
    const quizId = location.state?.situationID;
    const fallback = location.state?.fallback ?? (() => {
        try { return JSON.parse(sessionStorage.getItem('quizFallback')); } catch { return null; }
    })();

    useEffect(() => {
        const fetchData = async () => {
            try {
                const result = await getQuizSubmitById(quizId);
                if (result) {
                    setData(result);
                    if (result?.quiz?.createdAt && result?.answeredAt) {
                        setCreatedAt(result.quiz.createdAt.toDate().toLocaleString().split(" ")[0]);
                        const diff = getDurationMMSS(result.quiz.createdAt, result.answeredAt);
                        setDuration(diff);
                    }
                    setScore(countScore(result?.results ?? []));
                }
            } catch (error) {
                console.error("前端取得測驗提交錯誤: ", error);
            } finally {
                setIsLoad(false);
            }
        };

        if (quizId) {
            fetchData();
        } else {
            setIsLoad(false);
        }
    }, [quizId]);

    const getDurationMMSS = (start, end) => {
        if (!start || !end) return "00:00";
        const durationMs = end.toMillis() - start.toMillis();
        if (durationMs < 0) return "00:00";
        const totalSeconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    };

    // 若 Firestore 資料載入失敗，從 fallback（navigation state）建構顯示資料
    const buildFallbackData = () => {
        if (!fallback?.questions?.length) return null;
        const results = fallback.correctAnswers.map((correct, i) => ({
            isCorrect: fallback.answers[i] == null ? null : fallback.answers[i] === correct
        }));
        return {
            quiz: { title: fallback.title, data: fallback.questions },
            answers: fallback.answers,
            results
        };
    };

    const displayData = data || buildFallbackData();
    const displayScore = data ? score : countScore(displayData?.results ?? []);

    const difficulty = 2;
    const labels = ["A", "B", "C"];

    return (
        <div className="submit-container">
            <div className="submit-paper">
                <div className="paper-header">
                    <div className="paper-info">
                        <p>姓名：<span className="user-info">史努比</span></p>
                        <div className="user-infoo">
                            <p>類型：
                                <span className="user-info">{displayData?.quiz?.title}</span>
                                <span className="stars">
                                    {Array.from({ length: 5 }, (_, i) => (
                                        <Star
                                            key={i}
                                            size={16}
                                            color={i < difficulty ? "#FFD700" : "#ccc"}
                                            fill={i < difficulty ? "#FFD700" : "#ccc"}
                                        />
                                    ))}
                                </span>
                            </p>
                            <p>日期：<span className="user-info">{createdAt ?? new Date().toLocaleDateString()}</span></p>
                            <p>用時：<span className="user-info">{duration ?? "--:--"}</span></p>
                        </div>
                    </div>
                    <div className="paper-score">
                        <div className="score-circle">
                            <span className="score">{displayScore}</span>
                        </div>
                    </div>
                </div>

                <div className="paper-body">
                    <div className="submit-question-header-row">
                        <span className="header-title"></span>
                        <span className="header-title"></span>
                        <span className="header-title question-title">題目</span>
                        <span className="header-title user-title">你的答案</span>
                        <span className="header-title correct-title">正確答案</span>
                    </div>
                    {isLoad ? (
                        <p>載入中...</p>
                    ) : !displayData || !displayData.quiz || !displayData.quiz.data?.length ? (
                        <p className="no-results">沒有題目資料</p>
                    ) : (
                        displayData.quiz.data.map((item, idx) => {
                            const userAnswerNum = displayData.answers[idx];
                            const userAnswer = userAnswerNum === 1 ? "O" : userAnswerNum === 2 ? "X" : "未作答";
                            const userLabel = labels[userAnswerNum - 1];

                            const correctAnswerNum = item.answer;
                            const correctAnswer = correctAnswerNum === 1 ? "O" : correctAnswerNum === 2 ? "X" : "-";
                            const correctLabel = labels[correctAnswerNum - 1];

                            const isCorrect = displayData.results[idx]?.isCorrect;
                            return (
                                <div key={idx} className={`submit-question-result`}>
                                    <div className="submit-question-header">
                                        <span className="submit-question-num">第{idx + 1}題</span>
                                        <span>
                                            {isCorrect === true ? (
                                                <CheckCircle color="#388e3c" size={20} />
                                            ) : isCorrect === false ? (
                                                <XCircle color="#d32f2f" size={20} />
                                            ) : null}
                                        </span>
                                    </div>

                                    {displayData.quiz.title === "初級" ? (
                                        <>
                                            <div className="submit-question-q">
                                                <img src={item.image} className="submit-question-image" />
                                                <span>{item.question_ab}</span>
                                            </div>
                                            <span className={`quiz-user-answer ${isCorrect ? "correct" : "wrong"}`}>{userAnswer}</span>
                                            <span className="quiz-correct-answer">{correctAnswer}</span>
                                        </>
                                    ) : (
                                        <>
                                            <div className="submit-question-q2">
                                                <span>{item.question_ab}</span>
                                                <div>
                                                    <button>中</button>
                                                    <p style={{margin:"0"}}>{item.question_ch}</p>
                                                </div>
                                            </div>
                                            <img className={`quiz-user-answer2 ${isCorrect ? "correct" : "wrong"}`} src={item.images?.[userLabel] ?? ""}></img>
                                            <img className="quiz-correct-answer2" src={item.images?.[correctLabel] ?? ""}></img>
                                        </>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="submit-actions">
                    <button className="btn-secondary" onClick={() => navigate('/quiz')}>
                        返回開始測驗
                    </button>
                    <button className="btn-primary" onClick={() => navigate('/quiz/situation')}>
                        查看答題情形
                    </button>
                </div>
            </div>
        </div>
    );
};
export default Panel_Submit;
