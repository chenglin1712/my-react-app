import { useId, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { apiPost } from "../../utils/apiClient";

const REASONS = [
    { value: "wrong_tribal", label: "族語有錯" },
    { value: "irrelevant", label: "答非所問" },
    { value: "too_hard", label: "太難懂" },
    { value: "too_long", label: "太長" },
    { value: "other", label: "其他" },
];

const COMMENT_MAX = 300;

// 助手回覆下方的讚／倒讚（路線圖 #30）。讚直接送出；倒讚先選原因（必填）、可補一句話，再送出。
// 送出的是「這一則問答」，後端用簽章確認回覆真的是助手說的；不含身分，管理者才看得到內容。
const BotFeedback = ({ question, reply, sig, meta, tribe }) => {
    const groupId = useId();
    const commentId = useId();
    const [status, setStatus] = useState("idle"); // idle | choosing | sending | done | error
    const [rating, setRating] = useState(null);
    const [reason, setReason] = useState("");
    const [comment, setComment] = useState("");
    const [errorShown, setErrorShown] = useState(false);

    const submit = async (nextRating, nextReason = "", nextComment = "") => {
        setRating(nextRating);
        setStatus("sending");
        try {
            await apiPost("/AIModel/feedback/", {
                rating: nextRating,
                reason: nextReason,
                comment: nextComment.trim(),
                question_text: question,
                reply_text: reply,
                sig,
                tribe,
                request_id: meta?.requestId || "",
                model: meta?.model || "",
                prompt_version: meta?.promptVersion || "",
            });
            setStatus("done");
        } catch {
            setStatus(nextRating === "down" ? "choosing" : "idle");
            setRating(nextRating === "down" ? "down" : null); // 讚失敗：回到未選狀態，讓使用者可以再按
            setErrorShown(true);
        }
    };

    if (status === "done") {
        return <p className="bot-feedback-thanks" role="status">謝謝你的回饋{rating === "down" ? "，我們會檢視這則回答" : ""}。</p>;
    }

    const choosing = status === "choosing" || (status === "sending" && rating === "down");
    const busy = status === "sending";

    return (
        <div className="bot-feedback" data-open={choosing || undefined}>
            <div className="bot-feedback-row" role="group" aria-label="這則回答有幫助嗎">
                <button
                    type="button"
                    className="bot-feedback-btn"
                    aria-label="有幫助"
                    aria-pressed={rating === "up"}
                    aria-disabled={busy || undefined}
                    onClick={() => { if (!busy) { setErrorShown(false); submit("up"); } }}
                >
                    <ThumbsUp size={16} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    className="bot-feedback-btn"
                    aria-label="沒幫助"
                    aria-pressed={rating === "down"}
                    aria-expanded={choosing}
                    aria-disabled={busy || undefined}
                    onClick={() => { if (!busy) { setErrorShown(false); setRating("down"); setStatus("choosing"); } }}
                >
                    <ThumbsDown size={16} aria-hidden="true" />
                </button>
                {errorShown && !choosing && <span className="bot-feedback-error" role="alert">沒送出，請稍後再試。</span>}
            </div>

            {choosing && (
                <form
                    className="bot-feedback-form"
                    onSubmit={(event) => { event.preventDefault(); if (reason && !busy) { setErrorShown(false); submit("down", reason, comment); } }}
                >
                    <fieldset className="bot-feedback-reasons" aria-describedby={`${groupId}-privacy`}>
                        <legend>哪裡不好？</legend>
                        {REASONS.map((item) => (
                            <label key={item.value} className="bot-feedback-chip" data-checked={reason === item.value || undefined}>
                                <input
                                    type="radio"
                                    name={groupId}
                                    value={item.value}
                                    checked={reason === item.value}
                                    onChange={() => setReason(item.value)}
                                />
                                <span>{item.label}</span>
                            </label>
                        ))}
                    </fieldset>
                    <label htmlFor={commentId} className="bot-feedback-label">補充說明（選填）</label>
                    <textarea
                        id={commentId}
                        className="bot-feedback-comment"
                        value={comment}
                        maxLength={COMMENT_MAX}
                        rows={2}
                        onChange={(event) => setComment(event.target.value)}
                    />
                    <p id={`${groupId}-privacy`} className="bot-feedback-privacy">
                        送出後，這則問答會給管理者檢視，不會附上你的身分。
                    </p>
                    {errorShown && <p className="bot-feedback-error" role="alert">沒送出，請稍後再試。</p>}
                    <div className="bot-feedback-actions">
                        <button type="submit" className="bot-feedback-submit" aria-disabled={!reason || busy || undefined}>
                            {busy ? "送出中" : "送出"}
                        </button>
                        <button
                            type="button"
                            className="bot-feedback-cancel"
                            aria-disabled={busy || undefined}
                            onClick={() => { if (busy) return; setStatus("idle"); setRating(null); setReason(""); setComment(""); setErrorShown(false); }}
                        >
                            取消
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default BotFeedback;
