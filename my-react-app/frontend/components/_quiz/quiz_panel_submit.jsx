import "../../static/css/_quiz/quiz_panel_submit.css"
import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { CheckCircle, XCircle, Star } from "lucide-react"
import { getQuizSubmitById, countScore } from "../../src/userServives/uploadDb"
import { useAuth } from "../../src/userServives/authContext"
import { TRIBE_FULL_NAME_BY_SLUG as TRIBE_NAME } from "../../src/constants/tribes"
import { QUIZ_LEVEL_ID_BY_NAME, QUIZ_LEVEL_TYPE_BY_NAME } from "./quizLevels"

// 四種題型的作答結果呈現差異頗大（圖片+單詞 vs 配對摘要 vs 短文+選項 vs
// 圖片選項），拆成各自的小型 renderer 比硬拼成同一套抽象更清楚；共用的題號/
// 對錯外框留在 Panel_Submit 本身，這裡只負責「這一題」中間那三欄要顯示什麼。
function TrueFalseResult({ item, userAnswer, correctAnswer, isCorrect }) {
    return (
        <>
            <div className="submit-question-q">
                <img src={item.image} className="submit-question-image" loading="lazy" />
                <span>{item.question_ab}</span>
            </div>
            <span className={`quiz-user-answer ${isCorrect ? "correct" : "wrong"}`}>{userAnswer}</span>
            <span className="quiz-correct-answer">{correctAnswer}</span>
        </>
    );
}

function ChoiceResult({ item, userLabel, correctLabel, isCorrect }) {
    return (
        <>
            <div className="submit-question-q2">
                <span>{item.question_ab}</span>
                <div>
                    <button type="button">中</button>
                    <p style={{ margin: "0" }}>{item.question_ch}</p>
                </div>
            </div>
            <img className={`quiz-user-answer2 ${isCorrect ? "correct" : "wrong"}`} src={item.images?.[userLabel] ?? ""} loading="lazy" />
            <img className="quiz-correct-answer2" src={item.images?.[correctLabel] ?? ""} loading="lazy" />
        </>
    );
}

function MatchingResult({ item, userAnswerNum, isCorrect }) {
    return (
        <>
            <div className="submit-question-q">
                <span>配合題：{item.pairs?.map(p => `${p.cn}→${p.word.word}`).join('；')}</span>
            </div>
            <span className={`quiz-user-answer-text ${isCorrect ? "correct" : "wrong"}`}>
                {userAnswerNum === 1 ? "全對" : userAnswerNum === 2 ? "有錯" : "未作答"}
            </span>
            <span className="quiz-correct-answer-text">全對</span>
        </>
    );
}

function ClozeResult({ item, userAnswerNum, correctAnswerNum, isCorrect }) {
    return (
        <>
            <div className="submit-question-q2">
                <span>{item.passage_ab}</span>
                <div>
                    <button type="button">中</button>
                    <p style={{ margin: "0" }}>{item.passage_ch}</p>
                </div>
            </div>
            <span className={`quiz-user-answer-text ${isCorrect ? "correct" : "wrong"}`}>
                {item.options?.[userAnswerNum - 1] ?? "未作答"}
            </span>
            <span className="quiz-correct-answer-text">{item.options?.[correctAnswerNum - 1] ?? "-"}</span>
        </>
    );
}

// 用題型（type）分派，不是用等級的中文顯示名稱——quiz/situation 資料目前只
// 存了等級中文名稱，還沒有獨立的 questionType 欄位，QUIZ_LEVEL_TYPE_BY_NAME
// 是暫時的對照表；資料庫真的補上 questionType 欄位後這裡可以直接切換成
// 直接讀該欄位，不用再繞經等級名稱。
const RESULT_RENDERERS = {
    true_false: TrueFalseResult,
    choice: ChoiceResult,
    matching: MatchingResult,
    cloze: ClozeResult,
};

const Panel_Submit = ({ tribe = "tayal" }) => {
    const navigate = useNavigate();
    const basePath = tribe === "tayal" ? "/quiz" : `/quiz/${tribe}`;
    const { userData } = useAuth();
    const [isLoad, setIsLoad] = useState(true);

    const [data, setData] = useState(null);
    const [createdAt, setCreatedAt] = useState(null);
    const [duration, setDuration] = useState(null);
    const [score, setScore] = useState(0);

    const location = useLocation();
    const quizId = location.state?.situationID;
    const fallback = location.state?.fallback ?? (() => {
        const raw = sessionStorage.getItem('quizFallback');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return null; }
    })();

    const getDurationMMSS = (start, end) => {
        if (!start || !end) return "00:00";
        const durationMs = end.toMillis() - start.toMillis();
        if (durationMs < 0) return "00:00";
        const totalSeconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    };

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

    // 若 Firestore 資料載入失敗，從 fallback（navigation state）建構顯示資料
    const buildFallbackData = () => {
        if (!fallback?.questions?.length) return null;
        const results = fallback.correctAnswers.map((correct, i) => ({
            isCorrect: fallback.answers[i] == null ? null : fallback.answers[i] === correct
        }));
        return {
            quiz: { title: fallback.title, data: fallback.questions },
            answers: fallback.answers,
            correctAnswers: fallback.correctAnswers,
            results
        };
    };

    const displayData = data || buildFallbackData();
    const displayScore = data ? score : countScore(displayData?.results ?? []);

    const difficulty = QUIZ_LEVEL_ID_BY_NAME[displayData?.quiz?.title] ?? 1;
    const labels = ["A", "B", "C", "D"];
    const displayName = userData?.firestoreData?.name ?? "未登入";

    return (
        <div className="submit-container">
            <div className="submit-paper">
                <div className="paper-header">
                    <div className="paper-info">
                        <p>姓名：<span className="user-info">{displayName}</span></p>
                        <div className="user-info-row">
                            <p>類型：
                                <span className="user-info">{TRIBE_NAME[tribe] ?? ""} {displayData?.quiz?.title}</span>
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

                            // 正確答案不再存在 quizs 文件的 data[i].answer（見
                            // uploadDb.jsx 的 uploadQuizDB 說明），改從本人專屬的
                            // situations 文件（getQuizSubmitById 回傳的 result.correctAnswers）
                            // 或 fallback 資料讀取。
                            const correctAnswerNum = displayData.correctAnswers?.[idx];
                            const correctAnswer = correctAnswerNum === 1 ? "O" : correctAnswerNum === 2 ? "X" : "-";
                            const correctLabel = labels[correctAnswerNum - 1];

                            const isCorrect = displayData.results[idx]?.isCorrect;
                            // 資料目前只存了等級中文名稱，還沒有獨立的 questionType
                            // 欄位，用 QUIZ_LEVEL_TYPE_BY_NAME 暫時對照；找不到對應
                            // type（例如等級名稱拼錯或資料異常）就退回 ChoiceResult，
                            // 跟原本「不是前三種名稱就走 else 分支」的行為一致。
                            const ResultRenderer = RESULT_RENDERERS[QUIZ_LEVEL_TYPE_BY_NAME[displayData.quiz.title]] ?? ChoiceResult;
                            return (
                                <div key={idx} className="submit-question-result">
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

                                    <ResultRenderer
                                        item={item}
                                        userAnswer={userAnswer}
                                        userAnswerNum={userAnswerNum}
                                        userLabel={userLabel}
                                        correctAnswer={correctAnswer}
                                        correctAnswerNum={correctAnswerNum}
                                        correctLabel={correctLabel}
                                        isCorrect={isCorrect}
                                    />
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="submit-actions">
                    <button className="btn-secondary" onClick={() => navigate(basePath)}>
                        返回開始測驗
                    </button>
                    <button className="btn-primary" onClick={() => navigate('/quiz/situation', { state: { tribe } })}>
                        查看答題情形
                    </button>
                </div>
            </div>
        </div>
    );
};
export default Panel_Submit;
