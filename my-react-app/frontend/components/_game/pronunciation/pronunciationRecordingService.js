import {
  collection, addDoc, getDocs, query, doc, deleteDoc,
  where, orderBy, limit, serverTimestamp,
} from "firebase/firestore";
import { db, getStorageInstance } from "../../../../firebase";

/**
 * pronunciations/{tribe}/recordings 的資料存取層，從 pronunciation_game.jsx
 * 抽出來，讓遊戲元件不用直接管 Firestore／Storage 細節。
 */

const MIN_REFERENCE_SCORE = 70;
const MAX_REFERENCE_RECORDINGS = 5;

// 取得該詞高分真人音檔（分數門檻以上，最多幾筆）。
// 只取 approved == true 的錄音（稽核 BE5-01）：score 是使用者自己帶的，規則只能檢查它是 0–100 的整數，
// 不能證明是真的比對結果，所以偽造高分的錄音若直接當參考音會污染其他學習者的評分。approved 只有後端
// （後台「發音錄音審核」頁核准）能寫，使用者建立錄音時不能帶（見 firestore.rules 的欄位白名單）。
export async function fetchReferenceUrls(tribe, word) {
  try {
    const q = query(
      collection(db, "pronunciations", tribe, "recordings"),
      where("word", "==", word),
      where("approved", "==", true),
      where("score", ">=", MIN_REFERENCE_SCORE),
      orderBy("score", "desc"),
      limit(MAX_REFERENCE_RECORDINGS),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data().storageUrl).filter(Boolean);
  } catch (error) {
    // 參考音檔只是輔助，失敗時仍回空陣列讓遊戲繼續；但要留紀錄——缺複合索引
    // （FAILED_PRECONDITION）之類的設定問題不能再靜默消失。
    console.error("取得參考真人音檔失敗:", error);
    return [];
  }
}

// 上傳錄音到 Firebase Storage，回傳公開 download URL。word 目前是字典詞彙本身
// （不是獨立的 item id），直接原樣拼進路徑；用 crypto.randomUUID() 當檔名
// 只是為了避免同一秒內上傳的檔名相撞，不是要藏資訊。
export async function uploadRecording(tribe, word, uid, blob) {
  const filename = `${crypto.randomUUID()}_${uid}.webm`;
  const [{ ref, uploadBytes, getDownloadURL }, storage] = await Promise.all([import("firebase/storage"), getStorageInstance()]);
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

// 撤回自己分享的錄音（稽核 FE5-05）：先刪 Storage 物件，再刪 Firestore 文件。
// 順序有意義：Firestore 文件是唯一記錄物件位置的地方，若先刪文件、Storage 刪除又失敗，音檔就成了
// 沒有任何文件指向的孤兒；反過來，物件已經不存在（404）時文件仍要能被刪掉，所以 object-not-found 當成功。
// 其他錯誤（權限、網路）直接丟出，文件保留，讓使用者可以重試。
export async function deleteOwnRecording(tribe, recordingId, storageUrl) {
  if (storageUrl) {
    const [{ ref, deleteObject }, storage] = await Promise.all([import("firebase/storage"), getStorageInstance()]);
    try {
      await deleteObject(ref(storage, storageUrl));
    } catch (error) {
      if (error?.code !== "storage/object-not-found") throw error;
    }
  }
  await deleteDoc(doc(db, "pronunciations", tribe, "recordings", recordingId));
}
