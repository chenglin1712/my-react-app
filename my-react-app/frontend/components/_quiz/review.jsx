import "../../static/css/_quiz/review.css"
import { useState, useEffect } from "react";
import { CircleHelp } from "lucide-react";
import { getCurrentSituation, getQuizById } from "../../src/userServives/uploadDb"
import { QUIZ_LEVEL_TYPE_BY_NAME } from "./quizLevels";
import { buildReviewQuestions } from "./reviewQuestionModel";
import ReviewTabs from "./ReviewTabs";
import QuestionExplanation from "./QuestionExplanation";
import { apiGet } from "../../utils/apiClient";
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
    // 「AI助手」分頁是否開放（後端功能旗標，預設關閉）；讀不到就當作沒開放
    const [aiEnabled, setAiEnabled] = useState(false);

    useEffect(() => {
        let cancelled = false;
        apiGet("/AIModel/quota/")
            .then((data) => { if (!cancelled) setAiEnabled(data?.features?.questionReview === true); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // 稽核 FE1-11／FE4-10：答題紀錄改成伺服器端分頁，一次讀一頁（getCurrentSituation 預設 20 筆），
    // 需要更早的紀錄再按「載入更早的紀錄」接著讀，不再一進頁面就讀出全部並逐筆查題目。
    const [cursor, setCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [listError, setListError] = useState("");
    // 稽核 FE4-20：按「查看測驗」到題目讀回來之前顯示讀取中；讀不到時給提示，不再沒反應
    const [viewingId, setViewingId] = useState(null);
    const [viewError, setViewError] = useState("");

    const loadPage = async (fromCursor) => {
        setListError("");
        try {
            const page = await getCurrentSituation({ cursor: fromCursor });
            setSituations((prev) => (fromCursor ? [...prev, ...page.situations] : page.situations));
            setCursor(page.cursor);
            setHasMore(page.hasMore);
        } catch (err) {
            console.error("載入失敗：", err);
            setListError("答題紀錄載入失敗，請稍後再試。");
        }
    };

    useEffect(() => {
        let cancelled = false;
        getCurrentSituation()
            .then((page) => {
                if (cancelled) return;
                setSituations(page.situations);
                setCursor(page.cursor);
                setHasMore(page.hasMore);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("載入失敗：", err);
                setListError("答題紀錄載入失敗，請稍後再試。");
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const loadMore = async () => {
        if (loadingMore) return;
        setLoadingMore(true);
        await loadPage(cursor);
        setLoadingMore(false);
    };

    // 第一頁就失敗：重讀第一頁；「載入更早的紀錄」失敗：從同一個 cursor 再讀一次
    const retryList = async () => {
        if (situations.length > 0) {
            await loadMore();
            return;
        }
        setLoading(true);
        await loadPage(null);
        setLoading(false);
    };

    const viewAttempt = async (situation) => {
        if (viewingId) return;
        setViewError("");
        setViewingId(situation.id);
        let quizData;
        try {
            quizData = await getQuizById(situation.quizId);
        } finally {
            setViewingId(null);
        }
        if (!quizData) {
            setViewError("這次測驗的題目已無法讀取（可能已被移除或網路不穩），請稍後再試。");
            return;
        }
        setSelectedQuiz({
            ...quizData,
            // 測驗題目本身的建立時間（createdAt）跟使用者這一次作答的時間
            // （answeredAt）是兩件事，複習頁要顯示的是後者。
            attemptId: situation.id,      // 單題講解用：伺服器靠它讀這次作答（路線圖 #22）
            answeredAt: situation.answeredAt,
            results: situation.results,
            answers: situation.answers,
            correctAnswers: situation.correctAnswers,
        });
        setSelectedQuestionIdx(null);
        setNavIndex(0);
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
                        aiEnabled={aiEnabled}
                    />

                    <div className="review-table-container">
                        {!selectedQuiz ? (
                            <>
                                {viewError && <p className="review-error-text" role="alert">{viewError}</p>}
                                {listError && !loading && (
                                    <div className="review-error-text" role="alert">
                                        <p className="mb-1">{listError}</p>
                                        <button type="button" className="view-btn" onClick={retryList}>重試</button>
                                    </div>
                                )}
                                <ReviewAttemptList
                                    situations={situations}
                                    loading={loading}
                                    error={!!listError && situations.length === 0}
                                    onViewAttempt={viewAttempt}
                                    viewingId={viewingId}
                                    hasMore={hasMore && !listError}
                                    loadingMore={loadingMore}
                                    onLoadMore={loadMore}
                                />
                            </>
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
                                {navIndex === 2 && (
                                    <>
                                        {selectedQuiz.attemptId && selectedQuestion && (
                                            <QuestionExplanation
                                                key={`${selectedQuiz.attemptId}-${selectedQuestion.idx}`}
                                                attemptId={selectedQuiz.attemptId}
                                                index={selectedQuestion.idx}
                                                tribe={selectedQuiz?.tribe || "tayal"}
                                            />
                                        )}
                                        <Comp_atayalAI tribe={selectedQuiz?.tribe || "tayal"} />
                                    </>
                                )}
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
