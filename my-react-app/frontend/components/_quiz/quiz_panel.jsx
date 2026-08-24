import "../../static/css/_quiz/quiz_panel.css"
import { useParams, useNavigate } from "react-router-dom";
import { useState } from 'react'
import AnswerBox from "./quiz_answerBox"
import MatchingQuestion from "./quiz_matching_question"
import ClozeQuestion from "./quiz_cloze_question"
import TrueFalseQuestion from "./quiz_true_false_question"
import ChoiceQuestion from "./quiz_choice_question"
import loadingAnimation from "../../src/animations/loading.json"
import { Star, CircleHelp } from "lucide-react";
import { uploadSituationDB } from "../../src/userServives/uploadDb"
import { useQuizPanelData } from "./useQuizPanelData"
import { trackEvent } from "../../utils/apiClient"
import { buildQuizAnswerEvents } from "./quizAnswerTracking"
import { useLottieAnimation } from "@hooks/useLottieAnimation";
import { QUIZ_LEVEL_NAME_BY_ID } from "./quizLevels";

const Panel = ({ tribe = "tayal" }) => {
    const { level } = useParams();
    const level_ch = QUIZ_LEVEL_NAME_BY_ID[parseInt(level, 10)];
    const basePath = tribe === "tayal" ? "/quiz" : `/quiz/${tribe}`;

    const navigate = useNavigate();

    const {
        data, dataLen, isLoading, quizInfo, savedQuestions, uploadFailed,
        userAnswers, userStars, currentQuestionIndex, setCurrentQuestionIndex,
        handleStar, handleAnswer, retry,
    } = useQuizPanelData(level, tribe, level_ch);

    const [showIntro, setShowIntro] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState("");

    //加載loading動畫
    const animation = useLottieAnimation({ animationData: loadingAnimation, enabled: isLoading });

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
        if (!quizInfo) return null;

        if (userAnswers.length == 0) {
            return await uploadSituationDB(quizInfo.id, null, null, null);
        }
        return await uploadSituationDB(quizInfo.id, quizInfo.ans, userAnswers, userStars);
    };

    // trackEvent 本身是 fire-and-forget，失敗不影響繳交流程，故意不 await。
    const trackQuizAnswers = () => {
        buildQuizAnswerEvents(data, quizInfo, userAnswers, tribe, level).forEach(
            (event) => trackEvent(event.eventType, { tribe: event.tribe, payload: event.payload }),
        );
    };

    // 點擊提交——主畫面按鈕與側邊欄 AnswerBox 共用這一個函式（見 <AnswerBox
    // onSubmit={handleSubmit}>）。原本 AnswerBox 自己有一份平行的、簡化過頭
    // 的送出邏輯：只彈確認框、清計時器、直接 navigate，完全沒有呼叫
    // uploadSituationDB／trackEvent，也沒有寫 sessionStorage fallback、沒有帶
    // situationID——使用者點側邊欄那顆「繳交試卷」，作答結果會直接遺失。
    const handleSubmit = async () => {
        if (isSubmitting) return;
        if (userAnswers.some(a => a === null)) {
            const confirmSubmit = window.confirm("⚠️您尚未作答完成，確定要繳交嗎？");
            if (!confirmSubmit) {
                return;
            }
        }

        setIsSubmitting(true);
        setSubmitError("");
        trackQuizAnswers();

        let situationID = null;
        try {
            situationID = await handleUploadSituation();
        } catch (err) {
            console.error("儲存作答結果失敗：", err);
        }
        if (!situationID) {
            // uploadSituationDB 失敗時回傳 undefined（它自己 catch 掉例外），
            // 不擋下導頁——既有的 sessionStorage fallback 仍能讓使用者看到這次
            // 的作答結果——但要讓使用者知道這次可能沒有真的存進資料庫，
            // 而不是讓他們以為分數已經存好了。
            setSubmitError("作答結果儲存失敗，這次的紀錄可能不會出現在「答題情形」裡。");
        }

        const fallbackData = {
            title: level_ch,
            tribe,
            questions: savedQuestions,
            answers: userAnswers,
            correctAnswers: quizInfo?.ans ?? []
        };
        try {
            sessionStorage.setItem('quizFallback', JSON.stringify(fallbackData));
        } catch (err) {
            console.error("暫存作答結果失敗：", err);
        }

        setIsSubmitting(false);
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

        // 題目建立失敗時如果只是讓繳交靜默失效，使用者會以為按鈕壞了；
        // 這裡明確擋在作答之前並給重試入口（見 useQuizPanelData 的 uploadFailed）。
        if (uploadFailed) {
            return (
                <div className="quiz-load-error text-center py-5">
                    <p>測驗建立失敗，作答結果將無法儲存，請重試。</p>
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
                    {submitError && <p className="quiz-submit-error" role="alert" style={{ color: '#d32f2f', textAlign: 'center', marginTop: '8px' }}>{submitError}</p>}
                    <button className="submit-button" onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting ? "送出中..." : "繳交試卷"}
                    </button>
                </div>
                <AnswerBox
                    dataLen={dataLen}
                    userAnswers={userAnswers}
                    userStars={userStars}
                    currentQuestionIndex={currentQuestionIndex}
                    setCurrentQuestionIndex={setCurrentQuestionIndex}
                    onSubmit={handleSubmit}
                    isSubmitting={isSubmitting}
                />
            </div>
        );
    }
};
export default Panel;
