import { useCallback, useEffect, useRef, useState } from "react";

// 兩個助手（懸浮聊天視窗、錯題補充說明）共用的「送出中」狀態機（路線圖 #36）：
// - 同一時間只送一個請求。isPending 是 state，同一個事件迴圈內連按兩次還看不到更新，所以用 ref 同步擋住重複送出
// - 每個請求一個 AbortController；元件卸載時自動中止，回應回來時也不會對已卸載的元件寫 state
// 回覆怎麼呈現、錯誤怎麼說明，由各助手自己決定。
//
// 用法：
//   const controller = request.begin();   // 已經有請求在送就回傳 null
//   if (!controller) return;
//   try { await call({ signal: controller.signal }); ... } finally { request.finish(); }
export default function useChatRequest() {
    const [isPending, setIsPending] = useState(false);
    const sendingRef = useRef(false);
    const abortRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
        };
    }, []);

    const begin = useCallback(() => {
        if (sendingRef.current) return null;
        sendingRef.current = true;
        setIsPending(true);
        const controller = new AbortController();
        abortRef.current = controller;
        return controller;
    }, []);

    const finish = useCallback(() => {
        sendingRef.current = false;
        if (mountedRef.current) setIsPending(false);
    }, []);

    // 使用者按「停止」：只中止請求，等待狀態由送出流程的 finally 收尾
    const abort = useCallback(() => abortRef.current?.abort(), []);

    // 作廢進行中的請求並立刻解除等待狀態（例如換帳號、登出）
    const discard = useCallback(() => {
        abortRef.current?.abort();
        sendingRef.current = false;
        setIsPending(false);
    }, []);

    return { isPending, mountedRef, begin, finish, abort, discard };
}
