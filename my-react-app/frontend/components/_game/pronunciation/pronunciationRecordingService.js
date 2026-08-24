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

const MIN_REFERENCE_SCORE = 70;
const MAX_REFERENCE_RECORDINGS = 5;

// 取得該詞高分真人音檔（分數門檻以上，最多幾筆）
export async function fetchReferenceUrls(tribe, word) {
  try {
    const q = query(
      collection(db, "pronunciations", tribe, "recordings"),
      where("word", "==", word),
      where("score", ">=", MIN_REFERENCE_SCORE),
      orderBy("score", "desc"),
      limit(MAX_REFERENCE_RECORDINGS),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data().storageUrl).filter(Boolean);
  } catch {
    return [];
  }
}

// 上傳錄音到 Firebase Storage，回傳公開 download URL。word 目前是字典詞彙本身
// （不是獨立的 item id），直接原樣拼進路徑；用 crypto.randomUUID() 當檔名
// 只是為了避免同一秒內上傳的檔名相撞，不是要藏資訊。
export async function uploadRecording(tribe, word, uid, blob) {
  const filename = `${crypto.randomUUID()}_${uid}.webm`;
  const storageRef = ref(storage, `pronunciations/${tribe}/${encodeURIComponent(word)}/${filename}`);
  await uploadBytes(storageRef, blob, { contentType: "audio/webm" });
  return getDownloadURL(storageRef);
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
