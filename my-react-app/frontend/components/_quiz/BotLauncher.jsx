import { forwardRef } from "react";
import { Bot } from "lucide-react";
import { useAuth } from "../../src/userServives/authContext";
import "../../static/css/_quiz/bot_launcher.css";

// 右下角的 AI 助手啟動鈕（類似 Messenger 的聊天泡泡）。
// 助手需要登入後的學習資料，所以只對登入使用者顯示；聊天視窗開著時由呼叫端不渲染它。
const BotLauncher = forwardRef(function BotLauncher({ onClick }, ref) {
    const { userData } = useAuth();
    if (userData?.firestoreData == null) return null;
    return (
        <button
            ref={ref}
            type="button"
            className="bot-launcher"
            aria-label="開啟 AI 助手"
            aria-haspopup="dialog"
            onClick={onClick}
        >
            <Bot size={26} aria-hidden="true" />
        </button>
    );
});

export default BotLauncher;
