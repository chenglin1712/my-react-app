import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw, X } from "lucide-react";
import { announce } from "@utils/announce";

const COPIED_MS = 2000;

// 助手回覆下方的「複製」與「重新產生」（路線圖 #33）。圖示按鈕都有文字名稱，狀態用 live region 公告。
// 重新產生只出現在最後一則回覆（重新產生會取代它，不是疊一則新的）。
const BotReplyActions = ({ text, canRegenerate, onRegenerate, disabled }) => {
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState(false);
    const timerRef = useRef(0);

    const mountedRef = useRef(true);
    const attemptRef = useRef(0);       // 連點時只認最後一次複製的結果，較早送出的晚到不能蓋掉它

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; clearTimeout(timerRef.current); };
    }, []);

    const handleCopy = async () => {
        attemptRef.current += 1;
        const attempt = attemptRef.current;
        try {
            await navigator.clipboard.writeText(text);
            if (!mountedRef.current || attempt !== attemptRef.current) return;
            setFailed(false);
            setCopied(true);
            announce("已複製回覆");
        } catch {
            if (!mountedRef.current || attempt !== attemptRef.current) return;
            // 沒有剪貼簿權限或不是安全連線：請使用者自己選取（畫面上也要看得到，不只是報讀）
            setCopied(false);
            setFailed(true);
            announce("無法自動複製，請手動選取文字複製", { assertive: true });
        }
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => { setCopied(false); setFailed(false); }, COPIED_MS);
    };

    return (
        <>
            <button type="button" className="bot-feedback-btn" aria-label={copied ? "已複製" : failed ? "複製失敗，請手動選取" : "複製回覆"} title={failed ? "複製失敗，請手動選取" : "複製回覆"} onClick={handleCopy}>
                {copied ? <Check size={16} aria-hidden="true" /> : failed ? <X size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            </button>
            {canRegenerate && (
                <button
                    type="button"
                    className="bot-feedback-btn"
                    aria-label="重新產生回覆"
                    title="重新產生回覆"
                    aria-disabled={disabled || undefined}
                    onClick={() => { if (!disabled) onRegenerate(); }}
                >
                    <RefreshCw size={16} aria-hidden="true" />
                </button>
            )}
        </>
    );
};

export default BotReplyActions;
