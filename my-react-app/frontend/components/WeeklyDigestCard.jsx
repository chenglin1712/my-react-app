import "../static/css/weeklyDigest.css";
import PropTypes from "prop-types";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { watchUid } from "./_quiz/botStorage";
import { dismissWeeklyDigest, watchWeeklyDigest } from "../src/userServives/weeklyDigestService";

const LEAVE_MS = 180;      // 與 CSS 的淡出時間一致

// 每週學習摘要卡片（路線圖 #25），助手視窗與首頁共用。沒登入、沒有摘要、已過期或已關閉都整塊不輸出：
// 這是輔助資訊，讀取失敗也不能影響所在的頁面。數字與複習詞是程式依作答紀錄算的，只有那兩三句話可能出自 AI。
// uid：父層已經知道登入者時直接傳進來（null＝沒登入），不再自己訂閱登入狀態；不傳（undefined）才自己訂閱。
const WeeklyDigestCard = ({ variant = "home", uid: uidProp }) => {
    const [watchedUid, setWatchedUid] = useState(null);
    const uid = uidProp === undefined ? watchedUid : uidProp;
    const [digest, setDigest] = useState(null);
    const [leaving, setLeaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const mountedRef = useRef(true);
    const timerRef = useRef(null);

    useEffect(() => {
        mountedRef.current = true;
        const stop = uidProp === undefined ? watchUid((next) => { if (mountedRef.current) setWatchedUid(next); }) : null;
        return () => {
            mountedRef.current = false;
            stop?.();
            clearTimeout(timerRef.current);
        };
    }, [uidProp === undefined]);        // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setDigest(null);
        setLeaving(false);
        if (!uid) return undefined;
        // 即時監聽：別的分頁或另一處（首頁／助手視窗）關閉後，這裡也跟著消失
        return watchWeeklyDigest(uid, setDigest);
    }, [uid]);

    if (!digest) return null;

    const dismiss = async () => {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            await dismissWeeklyDigest(uid);
        } catch {
            if (mountedRef.current) {
                setBusy(false);
                setError("沒有關閉成功，請稍後再試。");
            }
            return;
        }
        if (!mountedRef.current) return;
        setLeaving(true);
        timerRef.current = setTimeout(() => { if (mountedRef.current) setDigest(null); }, LEAVE_MS);
    };

    const { stats, words } = digest;
    return (
        <section className="weekly-digest" data-variant={variant} data-leaving={leaving || undefined} aria-label="本週學習摘要">
            <div className="weekly-digest-head">
                <h3 className="weekly-digest-title">本週學習摘要</h3>
                <button type="button" className="weekly-digest-close" onClick={dismiss} disabled={busy} aria-label="關閉本週學習摘要">
                    <X size={18} aria-hidden="true" />
                </button>
            </div>
            <p className="weekly-digest-summary">{digest.summary}</p>
            <p className="weekly-digest-stats">
                練習 {stats.attempts} 次，共 {stats.questions} 題，答對 {stats.correct} 題
            </p>
            {words.length > 0 && (
                <div className="weekly-digest-words">
                    <p className="weekly-digest-words-label">建議回頭複習</p>
                    <ul aria-label="建議複習的詞">
                        {words.map((item) => (
                            <li key={item.word}>
                                <span className="weekly-digest-word">{item.word}</span>
                                <span className="weekly-digest-wrong">答錯 {item.wrong} 次</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {digest.fromModel && <p className="weekly-digest-note">這段話由 AI 依你的作答統計整理，數字與詞來自你的作答紀錄。</p>}
            <p className="weekly-digest-error" role="status" aria-live="polite">{error}</p>
        </section>
    );
};

WeeklyDigestCard.propTypes = { variant: PropTypes.oneOf(["home", "bot"]), uid: PropTypes.string };

export default WeeklyDigestCard;
