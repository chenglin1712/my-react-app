import { cleanDigest } from "../../utils/weeklyDigest";

// 每週學習摘要（路線圖 #25）：users/{uid}/weeklyDigest/current。只讀與「關閉」兩個動作，規則見 firestore.rules。
// firebase 用動態載入：首頁與助手視窗都會用到這個服務，不能因為它讓沒登入的訪客多載一包 Firestore。

const load = () => Promise.all([import("../../../firebase"), import("firebase/firestore")]);

/**
 * 訂閱目前登入者的摘要，每次變動都呼叫 onChange(整理後的摘要或 null)；沒有、過期、已關閉都是 null。
 * 用即時監聽而不是只讀一次：首頁與助手視窗（或兩個分頁）同時開著時，一處關閉，另一處立刻跟著消失。
 * 回傳取消訂閱的函式（訂閱還在建立時就被取消也安全）。讀取失敗當作沒有摘要。
 */
export function watchWeeklyDigest(uid, onChange) {
    if (!uid) {
        onChange(null);
        return () => {};
    }
    let stopped = false;
    let unsubscribe = () => {};
    load().then(([{ db }, { doc, onSnapshot }]) => {
        if (stopped) return;
        unsubscribe = onSnapshot(
            doc(db, "users", uid, "weeklyDigest", "current"),
            (snap) => { if (!stopped) onChange(snap.exists() ? cleanDigest(snap.data()) : null); },
            () => { if (!stopped) onChange(null); },
        );
    }).catch(() => { if (!stopped) onChange(null); });
    return () => {
        stopped = true;
        unsubscribe();
    };
}

/** 關閉這一週的摘要（寫 dismissedAt）。助手視窗與首頁共用同一份，關掉一處另一處下次也不再出現。 */
export async function dismissWeeklyDigest(uid) {
    const [{ db }, { doc, updateDoc, serverTimestamp }] = await load();
    await updateDoc(doc(db, "users", uid, "weeklyDigest", "current"), { dismissedAt: serverTimestamp() });
}
