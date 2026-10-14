import { useSyncExternalStore } from "react";

// 離線寫入策略（審查項 P2-104）：需要連線才能完成的動作（送出檢舉、提交試卷、分享錄音、翻譯、辨識圖片）
// 在離線時把按鈕停用並說明原因，而不是讓使用者按下去才收到一般的「失敗」訊息。
// navigator.onLine 為 false 一定是離線；為 true 不保證連得到伺服器，所以連線中的失敗仍由各流程自己處理。
const subscribe = (callback) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};

const getSnapshot = () => (typeof navigator === "undefined" ? true : navigator.onLine);

/** 目前是否在線上；連線狀態改變時會跟著更新。 */
export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
