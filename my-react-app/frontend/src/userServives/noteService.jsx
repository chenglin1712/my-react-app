import { db } from "../../../firebase";
import {
  addDoc, collection, doc, getCountFromServer, getDoc, getDocs,
  limit, orderBy, query, runTransaction, serverTimestamp, startAfter, updateDoc, where,
} from "firebase/firestore";

/**
 * sharedNotes 集合的資料存取層。原本 _note/index.jsx（新增分享筆記）與
 * _note/noteshare.jsx（分頁查詢、按讚、刪除）各自內嵌原始 Firestore 讀寫，
 * 這裡集中成單一資料來源，跟 userServive.jsx／uploadDb.jsx 同樣的模式。
 */
const SHARED_NOTES_COLLECTION = "sharedNotes";

// 分頁 tab 對應的 Firestore orderBy 欄位（sharedNotes 建立時一律會寫入
// createdAt/likes，見 shareNote()，故 orderBy 不會漏掉正常建立的筆記）
const SORT_FIELD = { latest: "createdAt", hot: "likes", my: "createdAt" };

function buildFilterConstraints(filter, myUid) {
  const constraints = [where("deleted", "==", false)];
  if (filter === "my") constraints.push(where("uid", "==", myUid));
  constraints.push(orderBy(SORT_FIELD[filter], "desc"));
  return constraints;
}

/** 新增一則分享筆記。 */
export async function shareNote({ pages, preview, image, uid, username, avatarUrl }) {
  return addDoc(collection(db, SHARED_NOTES_COLLECTION), {
    pages,
    preview,
    image: image || "",
    createdAt: serverTimestamp(),
    likes: 0,
    likedBy: [],
    uid,
    username,
    avatarUrl,
    deleted: false,
  });
}

/**
 * 依 filter tab 做游標分頁查詢。afterDoc 傳前一頁最後一筆的 QueryDocumentSnapshot
 * 即為下一頁；不傳則從第一頁開始。多查 1 筆用來判斷 hasMore，回傳時已切回
 * pageSize 筆。
 */
export async function fetchSharedNotesPage({ filter, myUid, afterDoc, pageSize }) {
  const constraints = [
    ...buildFilterConstraints(filter, myUid),
    ...(afterDoc ? [startAfter(afterDoc)] : []),
    limit(pageSize + 1),
  ];
  const snap = await getDocs(query(collection(db, SHARED_NOTES_COLLECTION), ...constraints));
  const rows = [];
  snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
  const hasMore = rows.length > pageSize;
  const notes = rows.slice(0, pageSize);
  const lastDoc = snap.docs[Math.min(pageSize, snap.docs.length) - 1] || null;
  return { notes, hasMore, lastDoc };
}

/** 依 filter tab 算目前符合條件的總筆數，僅供分頁頁碼顯示參考。 */
export async function fetchSharedNotesCount({ filter, myUid }) {
  const constraints = [where("deleted", "==", false)];
  if (filter === "my") constraints.push(where("uid", "==", myUid));
  const countSnap = await getCountFromServer(query(collection(db, SHARED_NOTES_COLLECTION), ...constraints));
  return countSnap.data().count;
}

/** 依 id 直接讀單筆分享筆記的完整內容（不依賴該筆是否已在目前分頁快取中）。 */
export async function fetchSharedNoteById(id) {
  const snap = await getDoc(doc(db, SHARED_NOTES_COLLECTION, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * 切換按讚狀態。在 transaction 內讀伺服器上最新的 likedBy 再決定新增/移除，
 * 不是呼叫端自己拿舊的 note 物件算好絕對值再整包覆寫——不同分頁/裝置/使用者
 * 同時按讚時，後者會互相蓋掉對方剛寫入的結果（見這批審查發現的按讚 race）。
 * 回傳 transaction 內算出的最新 { likes, likedBy }，呼叫端用這個回傳值同步
 * 本地畫面，不要自己再算一次。
 */
export async function toggleNoteLike(noteId, uid) {
  const docRef = doc(db, SHARED_NOTES_COLLECTION, noteId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists()) {
      throw new Error("這則筆記已經不存在了");
    }
    const data = snap.data();
    const likedBy = Array.isArray(data.likedBy) ? data.likedBy : [];
    const alreadyLiked = likedBy.includes(uid);
    const newLikedBy = alreadyLiked
      ? likedBy.filter((id) => id !== uid)
      : [...likedBy, uid];
    const newLikes = Math.max(0, newLikedBy.length);
    tx.update(docRef, { likes: newLikes, likedBy: newLikedBy });
    return { likes: newLikes, likedBy: newLikedBy };
  });
}

/** 軟刪除（deleted: true），不是真的從 Firestore 移除文件。 */
export async function softDeleteNote(noteId) {
  return updateDoc(doc(db, SHARED_NOTES_COLLECTION, noteId), { deleted: true });
}
