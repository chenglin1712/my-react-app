import {
  collection, addDoc, getDocs, query,
  where, orderBy, limit, serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../../../firebase";

/**
 * pronunciations/{tribe}/recordings 的資料存取層，從 pronunciation_game.jsx
 * 抽出來，讓遊戲元件不用直接管 Firestore／Storage 細節。
 */

// 取得該詞高分真人音檔（score >= 70，最多 5 筆）
export async function fetchReferenceUrls(tribe, word) {
  try {
    const q = query(
      collection(db, "pronunciations", tribe, "recordings"),
      where("word", "==", word),
      where("score", ">=", 70),
      orderBy("score", "desc"),
      limit(5),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data().storageUrl).filter(Boolean);
  } catch {
    return [];
  }
}

// 上傳錄音到 Firebase Storage，回傳公開 download URL
export async function uploadRecording(tribe, word, uid, blob) {
  const filename = `${Date.now()}_${uid}.webm`;
  const storageRef = ref(storage, `pronunciations/${tribe}/${word}/${filename}`);
  await uploadBytes(storageRef, blob, { contentType: "audio/webm" });
  return await getDownloadURL(storageRef);
}

// 寫 Firestore metadata
export async function saveRecordingMeta(tribe, word, uid, score, storageUrl) {
  await addDoc(collection(db, "pronunciations", tribe, "recordings"), {
    word,
    tribe,
    uid,
    score,
    storageUrl,
    createdAt: serverTimestamp(),
  });
}
