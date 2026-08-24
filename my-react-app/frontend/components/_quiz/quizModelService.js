import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../firebase";

/**
 * users/{uid}.quiz_model 的資料存取層（IRT 學習模型：ability/user_errors/
 * type_stats...），從 quiz_recommon_question.jsx 抽出來。
 *
 * saveQuizModel 用 updateDoc，假設 users/{uid} 文件一定已經存在（註冊流程已經
 * 建立，見 src/userServives/uploadDb.jsx）——能呼叫到這裡代表使用者已登入，
 * 不是「文件可能不存在」的情境，所以不用額外處理 updateDoc 對不存在文件會
 * 失敗的狀況。
 */

export async function loadQuizModel(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data().quiz_model || {}) : {};
}

export async function saveQuizModel(uid, quizModel) {
  await updateDoc(doc(db, "users", uid), { quiz_model: quizModel });
}
