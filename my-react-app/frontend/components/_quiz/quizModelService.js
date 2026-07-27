import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../firebase";

/**
 * users/{uid}.quiz_model 的資料存取層（IRT 學習模型：ability/user_errors/
 * type_stats...），從 quiz_recommon_question.jsx 抽出來。
 */

export async function loadQuizModel(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? (snap.data().quiz_model || {}) : {};
}

export async function saveQuizModel(uid, quizModel) {
  await updateDoc(doc(db, "users", uid), { quiz_model: quizModel });
}
