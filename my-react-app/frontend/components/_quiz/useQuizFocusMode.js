import { useEffect } from "react";

// 作答專注模式（Apple 化步驟 4-6a）：作答畫面掛載期間，在 <html> 上掛 data-quiz-focus，
// quiz_focus.css 靠它把全站導覽、手機 tab bar、測驗選單與頁尾收起來，讓畫面只剩題目。
// 離開作答（結果頁、換頁、卸載）一定要移除，不然別的頁面會沒有導覽。
// 離開測驗的出口仍是題目上方的「離開測驗」按鈕（有確認）。
//
// 屬性是全域的，所以用計數管理擁有權：有 N 個地方同時要求專注模式，要等最後一個離開才移除，
// 不會因為其中一個先卸載就把另一個還需要的關掉（也不受 StrictMode 的 setup→cleanup→setup 影響）。
export const QUIZ_FOCUS_ATTR = "data-quiz-focus";

let activeCount = 0;

export function useQuizFocusMode(enabled = true) {
    useEffect(() => {
        if (!enabled) return undefined;
        const root = document.documentElement;
        activeCount += 1;
        root.setAttribute(QUIZ_FOCUS_ATTR, "true");
        return () => {
            activeCount = Math.max(0, activeCount - 1);
            if (activeCount === 0) root.removeAttribute(QUIZ_FOCUS_ATTR);
        };
    }, [enabled]);
}
