import "../../static/css/_quiz/review_AI.css";
import PropTypes from "prop-types";
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { apiPost } from "../../utils/apiClient";
import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";
import ReviewSections from "./ReviewSections";

const EXPLAIN_URL = import.meta.env.VITE_API_REVIEW_QUESTION_URL || "/AIModel/review_question/";

// 依錯誤類型給學生看得懂的說明與下一步（不顯示後端的原始訊息）
const errorMessage = (err) => {
    if (err?.data?.code === "ai_question_review_disabled") return "題目講解目前尚未開放。";
    if (err?.data?.code === "ai_assistant_disabled") return "AI 助手目前暫停服務，請稍後再試。";
    if (err?.status === 404) return "找不到這一題的作答紀錄，可能已經無法講解。";
    if (err?.status === 429) return err?.data?.code === "ai_daily_quota_exceeded"
        ? "今天的提問次數已經用完了，明天 00:00 重置。"
        : "請求太頻繁，請稍等一下再試。";
    return "暫時無法產生講解，請稍後再試。";
};

// 針對複習頁選到的「這一題」請助手講解（路線圖 #22）。只送 attemptId 與題號，題目內容與學生的答案由伺服器自己讀。
// 按下才呼叫（會用到付費額度），不自動送出。父層用 key 在換題時重設狀態。
const QuestionExplanation = ({ attemptId, index, tribe }) => {
    const [status, setStatus] = useState("idle");      // idle | loading | done | error
    const [result, setResult] = useState(null);
    const [error, setError] = useState("");
    const { playAudio, failedAudio } = useAuthorizedAudioPlayback();
    const controllerRef = useRef(null);

    // 離開這一題（換題、切分頁）就中止請求：卸載後不更新狀態，也不讓過期的請求繼續等
    useEffect(() => () => controllerRef.current?.abort(), []);

    const explain = async () => {
        if (status === "loading") return;               // 等待中不重複送出；按鈕不用 disabled，焦點才不會掉走
        setStatus("loading");
        const controller = new AbortController();
        controllerRef.current = controller;
        try {
            const data = await apiPost(EXPLAIN_URL, { attempt_id: attemptId, index }, { signal: controller.signal });
            if (controller.signal.aborted) return;
            setResult(data);
            setStatus("done");
        } catch (err) {
            if (controller.signal.aborted) return;
            setError(errorMessage(err));
            setStatus("error");
        }
    };

    const notice = result?.refused || result?.failed;
    return (
        <section className="question-explain" aria-labelledby="question-explain-title">
            <h4 id="question-explain-title">這一題的講解</h4>
            {status !== "done" && (
                <p className="question-explain-hint">
                    助手會看這一題的題目、你的作答和正確答案，說明差別在哪。講解是推測，未經族語專家確認。
                </p>
            )}
            <button
                type="button"
                className="question-explain-button"
                onClick={explain}
                aria-disabled={status === "loading"}
            >
                {status === "loading" ? "助手整理中…" : status === "done" || status === "error" ? "重新講解" : "請助手講解這一題"}
            </button>

            <div className="question-explain-result" role="status" aria-live="polite" aria-busy={status === "loading"}>
                {status === "error" && <p className="question-explain-error">{error}</p>}
                {status === "done" && result && (
                    <>
                        <p className="question-explain-answers">
                            <span>你的作答：{result.user_answer}</span>
                            <span>正確答案：{result.correct_answer}</span>
                        </p>
                        {result.difference && (
                            <p className={notice ? "review-notice" : "question-explain-difference"}>{result.difference}</p>
                        )}
                        {!notice && <ReviewSections sections={result.sections} tribe={tribe} interactive />}
                        {!notice && result.words?.length > 0 && (
                            <ul className="question-explain-words" aria-label="題目裡的辭典詞條">
                                {result.words.map((w) => {
                                    const audioFailed = Boolean(w.audio) && failedAudio?.has(w.audio);
                                    return (
                                        <li key={w.tayal}>
                                            <span className="word">{w.tayal}</span>
                                            <span className="question-explain-gloss">{w.chinese || "（辭典沒有中文解釋）"}</span>
                                            {w.audio && !audioFailed && (
                                                <button
                                                    type="button"
                                                    className="review-word-play"
                                                    aria-label={`播放「${w.tayal}」的發音`}
                                                    onClick={() => playAudio?.(w.audio)}
                                                >
                                                    <span className="review-word-play-icon"><Play size={14} aria-hidden="true" /></span>
                                                </button>
                                            )}
                                            {audioFailed && <span className="review-word-muted">音檔無法播放</span>}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </>
                )}
            </div>
        </section>
    );
};

QuestionExplanation.propTypes = {
    attemptId: PropTypes.string.isRequired,
    index: PropTypes.number.isRequired,
    tribe: PropTypes.string.isRequired,
};

export default QuestionExplanation;
