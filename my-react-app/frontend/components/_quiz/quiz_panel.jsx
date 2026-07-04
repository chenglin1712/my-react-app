import "../../static/css/_quiz/quiz_panel.css"
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from 'react'
import AnswerBox from "./quiz_answerBox"
import MatchingQuestion from "./quiz_matching_question"
import ClozeQuestion from "./quiz_cloze_question"
import lottie from 'lottie-web';
import loadingAnimation from "../../src/animations/loading.json"
import { Star, CircleHelp } from "lucide-react";
import { uploadQuizDB, uploadSituationDB } from "../../src/userServives/uploadDb"

const Panel = ({ tribe = "tayal" }) => {
    const levels = ["初級", "中級", "中高級", "高級"];
    const { level } = useParams();
    const level_ch = levels[parseInt(level) - 1];
    const basePath = tribe === "tayal" ? "/quiz" : `/quiz/${tribe}`;

    const navigate = useNavigate();
    const animation = useRef(null);

    const [data, setData] = useState([]);
    const [dataLen, setDataLen] = useState(0);
    const [userAnswers, setUserAnswers] = useState([]);
    const [userStars, setUserStars] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    const [quizInfo, setQuizInfo] = useState(null);
    const [savedQuestions, setSavedQuestions] = useState([]);

    const [showIntro, setShowIntro] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    //加載loading動畫
    useEffect(() => {
        if (!animation.current) return;
        const instance = lottie.loadAnimation({
            container: animation.current,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            animationData: loadingAnimation,
        });
        return () => instance.destroy();
    }, [isLoading]);

    //取得後端初級測驗資料
    useEffect(() => {
        let isMounted = true;
        async function fetchData() {
            setIsLoading(true);
            try {
                const response = await fetch(`${import.meta.env.VITE_API_QUIZ_URL}?level=${level}&tribe=${tribe}`);
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                const responseData = await response.json();
                if (isMounted) {
                    setData(responseData);
                    if (responseData && responseData.parts &&
                        responseData.parts[0] && responseData.parts[0].questions) {
                        setTimeout(() => {
                            const qLen = responseData.parts[0].questions.length;
                            setIsLoading(false);
                            setDataLen(qLen);
                            setUserAnswers(Array(qLen).fill(null));
                            setUserStars(Array(qLen).fill("F"));
                        }, 1000);
                    } else {
                        setIsLoading(false);
                    }
                }
            } catch (error) {
                console.error('取得資料失敗: ', error);
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }
        fetchData();
        return () => {
            isMounted = false;
        };
    }, [retryCount]);

    //測驗資料傳至資料庫
    useEffect(() => {
        if (!data || !data.parts || !data.parts[0]?.questions) return;
        const handlleUploadQuiz = async () => {
            const questions = data.parts[0].questions;
            const formatted = questions.map((q) => {
                if (data.parts[0].type === "true_false") {
                    return {
                        question_ab: q.question_ab,
                        image: q.image,
                        audio: q.audio,
                        options: {
                            "1": "O (符合)",
                            "2": "X (不符合)"
                        },
                        answer: q.answer
                    };
                } else if (data.parts[0].type === "choice") {
                    return {
                        question_ab: q.question_ab,
                        question_ch: q.question_ch,
                        audio: q.audio,
                        images: {
                            A: q.imageA,
                            B: q.imageB,
                            C: q.imageC
                        },
                        answer: parseInt(q.answer)
                    };
                } else if (data.parts[0].type === "matching") {
                    return {
                        pairs: q.pairs,
                        answer: q.answer
                    };
                } else if (data.parts[0].type === "cloze") {
                    return {
                        passage_ab: q.passage_ab,
                        passage_ch: q.passage_ch,
                        options: q.options,
                        answer: parseInt(q.answer)
                    };
                }
            });
            setSavedQuestions(formatted);
            const quiz = await uploadQuizDB(level_ch, formatted, tribe);
            setQuizInfo(quiz);
        };
        handlleUploadQuiz();
    }, [data, level_ch, tribe]);

    // 下一題
    const nextQuestion = () => {
        if (currentQuestionIndex < data.parts[0].questions.length - 1) {
            setCurrentQuestionIndex(currentQuestionIndex + 1);
        }
    };

    // 上一題
    const previousQuestion = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(currentQuestionIndex - 1);
        }
    };

    //點擊星星
    const handleStar = () => {
        const updateStars = [...userStars];
        updateStars[currentQuestionIndex] = updateStars[currentQuestionIndex] == "T" ? "F" : "T";
        setUserStars(updateStars);
    };

    //點擊選項
    const handleAnswer = (choice) => {
        const updateAns = [...userAnswers];
        updateAns[currentQuestionIndex] = choice;
        setUserAnswers(updateAns);
    };

    //點擊提交
    const handleSubmmit = async () => {
        if (userAnswers.some(a => a === null)) {
            const confirmSubmit = window.confirm("⚠️您尚未作答完成，確定要繳交嗎？");
            if (!confirmSubmit) {
                return;
            }
        }
        const situationID = await handleUploadSituation();
        const fallbackData = {
            title: level_ch,
            tribe,
            questions: savedQuestions,
            answers: userAnswers,
            correctAnswers: quizInfo?.ans ?? []
        };
        sessionStorage.setItem('quizFallback', JSON.stringify(fallbackData));
        navigate(`${basePath}/${level}/submit`, {
            state: {
                situationID,
                fallback: fallbackData
            }
        });
    };

    //答題情形傳至資料庫
    const handleUploadSituation = async () => {
        if (!quizInfo) return;

        let situationId = null;
        if (userAnswers.length == 0) {
            situationId = await uploadSituationDB(quizInfo.id, null, null, null);
        } else {
            situationId = await uploadSituationDB(quizInfo.id, quizInfo.ans, userAnswers, userStars);
        }
        return situationId;
    };

    //在一開始先加載所有圖片，避免切換題目有延遲
    useEffect(() => {
        if (data?.parts?.[0]?.questions) {
            const type = data.parts[0].type;
            data.parts[0].questions.forEach((q) => {
                if (type === "true_false" && q.image) {
                    const img = new Image();
                    img.src = q.image;
                } else if (type === "choice") {
                    ["imageA", "imageB", "imageC"].forEach((key) => {
                        if (q[key]) {
                            const img = new Image();
                            img.src = q[key];
                        }
                    });
                }
            });
        }
    }, [data]);

    //加載題目畫面
    if (isLoading) {
        return (
            <div className="load-container">
                <div className="load-title">題目加載中...</div>
                <div className="load-animate" ref={animation}></div>
            </div>
        );
    } else {
        if (!data || !data.parts || !data.parts[0].questions || data.parts[0].questions.length === 0) {
            return (
                <div className="quiz-load-error text-center py-5">
                    <p>測驗資料加載失敗，請重試。</p>
                    <button onClick={() => setRetryCount((c) => c + 1)}>重新載入</button>
                </div>
            );
        }

        const currentQuestion = data.parts[0].questions[currentQuestionIndex];

        return (
            <div className="panel-container">
                <div className="panel-quiz-container">
                    <div className="panel-header">
                        <button
                            className="exit-btn"
                            onClick={() => {
                                const isConfirmed = window.confirm("你確定要離開測驗嗎？未完成的測驗將不會保存。");
                                if (isConfirmed) {
                                    navigate(basePath);
                                }
                            }}
                        >離開測驗</button>

                        <h2>{level_ch}</h2>

                        <div className="intro-container">
                            <button className="intro-btn" onClick={() => { setShowIntro(!showIntro) }}>
                                <CircleHelp />說明
                            </button>

                            {showIntro && (
                                <div className="intro-box">
                                    <p className="parts-title">{data.parts[0].title.replace(/.*[:：]/, "")}</p>
                                    <p>{data.parts[0].intro}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div>
                        <div className="question-container">
                            <div className="title-container">
                                <p><strong>題目{currentQuestionIndex + 1}：</strong></p>
                                {data.parts[0].type === "true_false" && (
                                    <audio controls>
                                        <source src={currentQuestion.audio} type="audio/mpeg" />
                                        您的瀏覽器不支持音檔。
                                    </audio>
                                )}
                                {data.parts[0].type === "choice" && (
                                    <p>{currentQuestion.question_ab}</p>
                                )}
                                <Star size={24} className={`${userStars[currentQuestionIndex] === "T" ? 'star' : ''}`} onClick={handleStar} />
                            </div>

                            {data.parts[0].type === "true_false" && (
                                <>
                                    <img src={currentQuestion.image} alt="Question" className="question-image" />
                                    <div className="answers">
                                        <button className={`${userAnswers[currentQuestionIndex] === 1 ? 'selected' : ''}`} onClick={() => handleAnswer(1)}>
                                            O (符合)
                                        </button>
                                        <button className={`${userAnswers[currentQuestionIndex] === 2 ? 'selected' : ''}`} onClick={() => handleAnswer(2)}>
                                            X (不符合)
                                        </button>
                                    </div>
                                </>
                            )}

                            {data.parts[0].type === "choice" && (
                                <div className="quiz-multi-images">
                                    {["A", "B", "C"].map((label, idx) => (
                                        <div
                                            key={idx}
                                            className={`quiz-image-box ${userAnswers[currentQuestionIndex] === idx + 1 ? "selected" : ""}`}
                                            onClick={() => handleAnswer(idx + 1)}
                                        >
                                            <span className="quiz-label">{label}</span>
                                            <img
                                                src={currentQuestion[`image${label}`]}
                                                alt={`選項 ${label}`}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {data.parts[0].type === "matching" && (
                                <MatchingQuestion
                                    key={currentQuestionIndex}
                                    question={currentQuestion}
                                    answered={userAnswers[currentQuestionIndex] != null}
                                    resultValue={userAnswers[currentQuestionIndex]}
                                    onAnswer={handleAnswer}
                                />
                            )}

                            {data.parts[0].type === "cloze" && (
                                <ClozeQuestion
                                    question={currentQuestion}
                                    selected={userAnswers[currentQuestionIndex]}
                                    onSelect={handleAnswer}
                                />
                            )}
                        </div>

                        <div className="navigation-buttons">
                            <button onClick={previousQuestion} disabled={currentQuestionIndex === 0}>
                                上一題
                            </button>
                            <button onClick={nextQuestion} disabled={currentQuestionIndex === data.parts[0].questions.length - 1}>
                                下一題
                            </button>
                        </div>
                    </div>
                    <button className="submit-button" onClick={handleSubmmit}>繳交試卷</button>
                </div>
                <AnswerBox
                    dataLen={dataLen}
                    userAnswers={userAnswers}
                    userStars={userStars}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                />
            </div>
        );
    }
};
export default Panel;