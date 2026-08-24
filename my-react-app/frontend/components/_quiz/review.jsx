import "../../static/css/_quiz/review.css"
import { useState, useEffect } from "react";
import { CircleHelp } from "lucide-react";
import { getCurrentSituation, getQuizById } from "../../src/userServives/uploadDb"
import { QUIZ_LEVEL_TYPE_BY_NAME } from "./quizLevels";
import { buildReviewQuestions } from "./reviewQuestionModel";
import ReviewTabs from "./ReviewTabs";
import ReviewAttemptList from "./ReviewAttemptList";
import ReviewAttemptDetail from "./ReviewAttemptDetail";
import ReviewQuestionDetail from "./ReviewQuestionDetail";
import Comp_discussion from "./review_discussion"
import Comp_atayalAI from "./review_AI"

const Review = () => {
    const [situations, setSituations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [navIndex, setNavIndex] = useState(0);
    const [showIntro, setShowIntro] = useState(false);

    const [selectedQuiz, setSelectedQuiz] = useState(null);
    const [selectedQuestionIdx, setSelectedQuestionIdx] = useState(null);

    useEffect(() => {
        const fetchSituations = async () => {
            try {
                const data = await getCurrentSituation();
                setSituations(data);
            } catch (err) {
                console.error("載入失敗：", err);
            } finally {
                setLoading(false);
            }
        };

        fetchSituations();
    }, []);

    const viewAttempt = async (situation) => {
        const quizData = await getQuizById(situation.quizId);
        if (quizData) {
            setSelectedQuiz({
                ...quizData,
                // 測驗題目本身的建立時間（createdAt）跟使用者這一次作答的時間
                // （answeredAt）是兩件事，複習頁要顯示的是後者。
                answeredAt: situation.answeredAt,
                results: situation.results,
                answers: situation.answers,
                correctAnswers: situation.correctAnswers,
            });
            setSelectedQuestionIdx(null);
            setNavIndex(0);
        }
    };

    // 返回測驗紀錄列表時，右側題目詳情也要一併清掉，不然會殘留上一份測驗
    // 的題目內容。
    const closeAttempt = () => {
        setSelectedQuiz(null);
        setSelectedQuestionIdx(null);
    };

    const reviewQuestions = selectedQuiz
        ? buildReviewQuestions({
            questions: selectedQuiz.data,
            answers: selectedQuiz.answers,
            correctAnswers: selectedQuiz.correctAnswers,
            results: selectedQuiz.results,
        })
        : [];
    const questionType = QUIZ_LEVEL_TYPE_BY_NAME[selectedQuiz?.title];
    const selectedQuestion = selectedQuestionIdx != null ? reviewQuestions[selectedQuestionIdx] : null;

    return (
        <>
            <div className="review-header">
                <h2 className="review-title">重點複習</h2>
                <button type="button" className="review-intro-btn" onClick={() => { setShowIntro(!showIntro) }}>
                    <CircleHelp />說明
                </button>

                {showIntro && (
                    <div className="review-intro-box">
                        <p className="review-parts-title">功能說明</p>
                        <ul>
                            <li><strong>測驗紀錄：</strong>查看歷次測驗紀錄，點選「查看測驗」檢視詳細題目。</li>
                            <li><strong>討論：</strong>與其他使用者一同討論解題思路與學習心得。</li>
                            <li><strong>AI助手：</strong>AI智慧協助，針對題目進行解說、延伸學習。</li>
                        </ul>
                        <p className="review-hint">💡提示：若尚未選擇題目，「討論」與「AI助手」將無法使用。</p>
                    </div>
                )}
            </div>

            <div className="review-container">
                <div style={{ width: "50%" }}>
                    <ReviewTabs
                        activeIndex={navIndex}
                        onChange={setNavIndex}
                        hasSelectedQuestion={!!selectedQuestion}
                    />

                    <div className="review-table-container">
                        {!selectedQuiz ? (
                            <ReviewAttemptList
                                situations={situations}
                                loading={loading}
                                onViewAttempt={viewAttempt}
                            />
                        ) : (
                            <div className="review-quiz-detail">
                                {navIndex === 0 && (
                                    <ReviewAttemptDetail
                                        quiz={selectedQuiz}
                                        reviewQuestions={reviewQuestions}
                                        onBack={closeAttempt}
                                        onViewQuestion={setSelectedQuestionIdx}
                                    />
                                )}
                                {navIndex === 1 && (<Comp_discussion />)}
                                {navIndex === 2 && (<Comp_atayalAI tribe={selectedQuiz?.tribe || "tayal"} />)}
                            </div>
                        )}
                    </div>
                </div>

                <div className="quiz-question-detail">
                    <ReviewQuestionDetail
                        questionType={questionType}
                        question={selectedQuestion}
                        onClose={() => setSelectedQuestionIdx(null)}
                    />
                </div>
            </div>
        </>
    );
};
export default Review;
