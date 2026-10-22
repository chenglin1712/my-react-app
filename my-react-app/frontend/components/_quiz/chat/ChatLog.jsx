import { forwardRef } from "react";
import { Bot } from "lucide-react";

// 兩個助手共用的對話紀錄區與「助手正在輸入」指示器（路線圖 #36）。樣式 class 由各助手傳入，各自的 CSS 不動。

// role="log"：新訊息會被報讀器依序念出，不打斷使用者正在做的事
export const ChatLog = forwardRef(function ChatLog({ className, children }, ref) {
    return (
        <div ref={ref} className={className} role="log" aria-live="polite" aria-relevant="additions" aria-label="對話紀錄">
            {children}
        </div>
    );
});

export function TypingBubble({ rowClassName, bubbleClassName, indicatorClassName }) {
    return (
        <div className={rowClassName}>
            <div className="avatar-small">
                <Bot />
            </div>
            <div className={bubbleClassName}>
                <span className="visually-hidden">助手正在輸入</span>
                <div className={indicatorClassName} aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        </div>
    );
}
