import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../../../firebase";

/**
 * reports 集合的資料存取層——跟 noteService.jsx／pronunicationRecordingService.js
 * 同一種「前端直寫 Firestore」慣例，不透過後端（見 firestore.rules 的
 * reports 規則：create 本身的驗證就足以擋掉濫用，不需要額外的後端端點）。
 */
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

    await addDoc(collection(db, "reports"), {
        targetType,
        targetId,
        targetTribe,
        reporterUid: auth.currentUser.uid,
        reason,
        reasonText: trimmedReasonText,
        status: "pending",
        createdAt: serverTimestamp(),
    });
}
