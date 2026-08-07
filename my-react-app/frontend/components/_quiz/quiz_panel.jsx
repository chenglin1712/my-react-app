import "../../static/css/_quiz/quiz_panel.css"
import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from 'react'
import AnswerBox from "./quiz_answerBox"
import MatchingQuestion from "./quiz_matching_question"
import ClozeQuestion from "./quiz_cloze_question"
import TrueFalseQuestion from "./quiz_true_false_question"
import ChoiceQuestion from "./quiz_choice_question"
import lottie from 'lottie-web';
import loadingAnimation from "../../src/animations/loading.json"
import { Star, CircleHelp } from "lucide-react";
import { uploadSituationDB } from "../../src/userServives/uploadDb"
import { useQuizPanelData } from "./useQuizPanelData"
import { trackEvent } from "../../utils/apiClient"
import { buildQuizAnswerEvents } from "./quizAnswerTracking"

const Panel = ({ tribe = "tayal" }) => {
    const levels = ["初級", "中級", "中高級", "高級"];
    const { level } = useParams();
    const level_ch = levels[parseInt(level) - 1];
    const basePath = tribe === "tayal" ? "/quiz" : `/quiz/${tribe}`;

    const navigate = useNavigate();
    const animation = useRef(null);

    const {
        data, dataLen, isLoading, quizInfo, savedQuestions,
        userAnswers, userStars, currentQuestionIndex, setCurrentQuestionIndex,
        handleStar, handleAnswer, retry,
    } = useQuizPanelData(level, tribe, level_ch);

    const [showIntro, setShowIntro] = useState(false);

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

    // trackEvent 本身是 fire-and-forget，失敗不影響繳交流程，故意不 await。
    const trackQuizAnswers = () => {
        buildQuizAnswerEvents(data, quizInfo, userAnswers, tribe, level).forEach(
            (event) => trackEvent(event.eventType, { tribe: event.tribe, payload: event.payload }),
        );
    };

    //點擊提交
    const handleSubmmit = async () => {
        if (userAnswers.some(a => a === null)) {
            const confirmSubmit = window.confirm("⚠️您尚未作答完成，確定要繳交嗎？");
            if (!confirmSubmit) {
                return;
            }
        }
        trackQuizAnswers();
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
                    <button onClick={retry}>重新載入</button>
                </div>
            );
        }

        const currentQuestion = data.parts[0].questions[currentQuestionIndex];
        const currentType = data.parts[0].type;

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
                                {currentType === "true_false" && (
                                    <audio controls>
                                        <source src={currentQuestion.audio} type="audio/mpeg" />
                                        您的瀏覽器不支持音檔。
                                    </audio>
                                )}
                                {currentType === "choice" && (
                                    <p>{currentQuestion.question_ab}</p>
                                )}
                                <Star size={24} className={`${userStars[currentQuestionIndex] === "T" ? 'star' : ''}`} onClick={handleStar} />
                            </div>

                            {currentType === "true_false" && (
                                <TrueFalseQuestion
                                    question={currentQuestion}
                                    selected={userAnswers[currentQuestionIndex]}
                                    onSelect={handleAnswer}
                                />
                            )}

                            {currentType === "choice" && (
                                <ChoiceQuestion
                                    question={currentQuestion}
                                    selected={userAnswers[currentQuestionIndex]}
                                    onSelect={handleAnswer}
                                />
                            )}

                            {currentType === "matching" && (
                                <MatchingQuestion
                                    key={currentQuestionIndex}
                                    question={currentQuestion}
                                    answered={userAnswers[currentQuestionIndex] != null}
                                    resultValue={userAnswers[currentQuestionIndex]}
                                    onAnswer={handleAnswer}
                                />
                            )}

                            {currentType === "cloze" && (
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
