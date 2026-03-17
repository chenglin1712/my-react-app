import { useEffect, useState, useRef } from "react";
import "../../static/css/_quiz/quiz_answerBox.css"
import { Timer } from "lucide-react"
import { useParams, useNavigate } from "react-router-dom";

const Box = ({ dataLen, userAnswers, userStars, setCurrentQuestionIndex }) => {
    const { level } = useParams();
    const navigate = useNavigate();

    const questions = Array.from({ length: dataLen }, (num, i) => (i + 1).toString());

    //----------------作答時間----------------//
    const [time, setTime] = useState(0);
    const [isRunning, setIsRunning] = useState(false);
    const intervalIdRef = useRef(null);
    const startTimeRef = useRef(0);

    useEffect(() => {
        if (isRunning) {
            intervalIdRef.current = setInterval(() => {
                setTime(Date.now() - startTimeRef.current);
            }, 1000);
        }

        return () => {
            clearInterval(intervalIdRef.current);
        };
    }, [isRunning]);

    const timeStart = () => {
        setIsRunning(true);
        startTimeRef.current = Date.now() - time;
    };

    const timeStopAndReset = () => {
        setTime(0);
        setIsRunning(false);
    };

    //格式化時間
    const timeFormat = () => {
        let minute = Math.floor(time / (1000 * 60) % 60);
        let sec = Math.floor((time / 1000) % 60);

        minute = String(minute).padStart(2, "0");
        sec = String(sec).padStart(2, "0");

        return `${minute}:${sec}`;
    };

    useEffect(() => {
        timeStart();
    }, []);
    //--------------------------------------//

    //點選測驗導覽，切換題目API
    const handleAnswerQ = (questionIndex) => {
        setCurrentQuestionIndex(questionIndex);
    };

    const handleSubmmit = () => {
        timeStopAndReset(); //繳交後先停止計時
        if (userAnswers.length == 0 || userAnswers.length != dataLen) {
            const confirmSubmit = window.confirm("⚠️您尚未作答完成，確定要繳交嗎？");
            if (!confirmSubmit) {
                return;
            }
        }
        navigate(`/quiz/${level}/submit`);
    };

    return (
        <div className="box-container">
            <h4 className="box-title">測驗導覽</h4>
            <div className="box-question-list">
                {questions.map((question, index) => {
                    const isAnswered = userAnswers[index] !== undefined;
                    const isStarred = userStars[index] === "T";
                    return (
                        <button
                            key={index}
                            className={`box-question-btn ${isAnswered ? "answer" : ""}`}
                            onClick={() => { handleAnswerQ(index) }}>
                            {question}
                            {isStarred && <span className="star-indicator">⭐</span>}
                        </button>
                    );
                })}
            </div>
            <div className="box-timer">
                <Timer size={20} /> 作答時間：{timeFormat()}
            </div>
            <button className="box-submit-btn" onClick={handleSubmmit}>
                繳交試卷
            </button>
        </div>
    );
};
export default Box;