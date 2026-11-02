import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../../firebase";

/**
 * reports 集合的資料存取層——跟 noteService.jsx／pronunicationRecordingService.js
 * 同一種「前端直寫 Firestore」慣例，不透過後端（見 firestore.rules 的
 * reports 規則：create 本身的驗證就足以擋掉濫用，不需要額外的後端端點）。
 */
export const REPORT_ALREADY_OR_DENIED = "report/already-or-denied";
const REPORT_TARGET_TYPES = ["note", "recording"];
const REPORT_REASONS = ["inappropriate", "wrong_content", "spam", "other"];

export async function submitReport({
    targetType, targetId, targetTribe = "", reason, reasonText = "",
}) {
    if (!auth.currentUser) {
        throw new Error("請先登入才能送出檢舉");
    }
    if (!REPORT_TARGET_TYPES.includes(targetType)) {
        throw new Error("不支援的檢舉類型");
    }
    if (!targetId) {
        throw new Error("缺少檢舉目標");
    }
    if (!REPORT_REASONS.includes(reason)) {
        throw new Error("請選擇檢舉原因");
    }

    const trimmedReasonText = (reasonText || "").trim().slice(0, 500);
    if (reason === "other" && !trimmedReasonText) {
        throw new Error("請填寫檢舉原因說明");
    }

    // 文件 ID 固定為 `{reporterUid}_{targetId}`：同一個人對同一個目標只會有一筆檢舉
    // （firestore.rules 的 reports create 規則要求這個 ID；稽核 RUL-5）。
    const reporterUid = auth.currentUser.uid;
    try {
        await setDoc(doc(db, "reports", `${reporterUid}_${targetId}`), {
            targetType,
            targetId,
            targetTribe,
            reporterUid,
            reason,
            reasonText: trimmedReasonText,
            status: "pending",
            createdAt: serverTimestamp(),
        });
    } catch (error) {
        // 已經檢舉過同一個目標時，第二次寫入會被規則視為對既有文件的更新而拒絕，
        // 但 permission-denied 也可能是其他原因（登入失效、規則尚未部署等），檢舉人
        // 又讀不到 reports，無法確認是哪一種，所以不能當成功處理：改丟帶固定 code 的
        // 錯誤，讓畫面如實說明「可能已經檢舉過」，而不是假裝送出成功。
        if (error?.code === "permission-denied") {
            const denied = new Error("可能已經檢舉過這個內容，或目前無法送出檢舉");
            denied.code = REPORT_ALREADY_OR_DENIED;
            throw denied;
        }
        throw error;
    }
}
