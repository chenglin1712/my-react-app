import { useEffect, useState, useRef } from "react";
import "../../static/css/_quiz/quiz_answerBox.css"
import { Timer } from "lucide-react"

// 純顯示元件：題號導覽、作答時間、送出按鈕。繳交完全交給 parent（見
// quiz_panel.jsx 的 handleSubmit）透過 onSubmit 處理——這裡原本自己有一套
// 平行的送出邏輯（見 quiz_panel.jsx 的說明，那套邏輯完全繞過存檔、且有多個
// 因為誤把「固定長度陣列」當成「動態成長陣列」而失效的判斷），拿掉之後不再
// 需要 useNavigate／useLocation／useParams，也不需要自己的 confirm。
const AnswerBox = ({ dataLen, userAnswers, userStars, currentQuestionIndex, setCurrentQuestionIndex, onSubmit, isSubmitting }) => {
    const questions = Array.from({ length: dataLen }, (_, i) => (i + 1).toString());

    // 作答時間：純顯示用的經過時間，跟繳交流程無關，元件掛載就開始計時、
    // 卸載（提交後導頁）時 effect cleanup 自然清掉 interval——不需要再像原本
    // 那樣在使用者按下繳交、甚至還沒確認就先手動停止歸零。
    const [elapsedMs, setElapsedMs] = useState(0);
    const startTimeRef = useRef(Date.now());

    useEffect(() => {
        const intervalId = setInterval(() => {
            setElapsedMs(Date.now() - startTimeRef.current);
        }, 1000);
        return () => clearInterval(intervalId);
    }, []);

    const timeFormat = () => {
        const minute = String(Math.floor(elapsedMs / (1000 * 60) % 60)).padStart(2, "0");
        const sec = String(Math.floor((elapsedMs / 1000) % 60)).padStart(2, "0");
        return `${minute}:${sec}`;
    };

    return (
        <div className="box-container">
            <h4 className="box-title">測驗導覽</h4>
            <div className="box-question-list">
                {questions.map((question, index) => {
                    // 未作答的值是 null（見 useQuizPanelData 用
                    // Array(qLen).fill(null) 初始化），不是 undefined；原本用
                    // !== undefined 判斷，null !== undefined 恆為 true，導致
                    // 所有題目從一開始就被標成「已作答」。
                    const isAnswered = userAnswers[index] != null;
                    const isStarred = userStars[index] === "T";
                    return (
                        <button
                            key={index}
                            type="button"
                            className={`box-question-btn ${isAnswered ? "answer" : ""}`}
                            aria-current={index === currentQuestionIndex ? "step" : undefined}
                            onClick={() => setCurrentQuestionIndex(index)}>
                            {question}
                            {isStarred && <span className="star-indicator">⭐</span>}
                        </button>
                    );
                })}
            </div>
            <div className="box-timer">
                <Timer size={20} /> 作答時間：{timeFormat()}
            </div>
            <button type="button" className="box-submit-btn" onClick={onSubmit} disabled={isSubmitting}>
                {isSubmitting ? "送出中..." : "繳交試卷"}
            </button>
        </div>
    );
};
export default AnswerBox;
