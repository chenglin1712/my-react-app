import {
  collection, doc, onSnapshot, runTransaction, getDocFromServer, serverTimestamp,
} from "firebase/firestore";
import { NOTE_LIMITS } from "./noteSyncCore";

/**
 * 雲端筆記的 Firestore 存取（D-2）。資料模型與規則見 firestore.rules 的「雲端筆記（D-1）」：
 *   users/{uid}/notes/{noteId}            每一頁一份文件
 *   users/{uid}/noteIndex/summary         頁數計數，新增／刪除必須和計數 ±1 在同一個交易裡
 *
 * db 由呼叫端傳入（不在這裡 import firebase.js），規則測試才能直接拿模擬器的連線來測這支。
 */

export class NoteLimitError extends Error {
  constructor() {
    super(`雲端筆記最多 ${NOTE_LIMITS.MAX_NOTES} 頁`);
    this.name = "NoteLimitError";
    this.code = "note-limit";
  }
}

const notesPath = (uid) => `users/${uid}/notes`;
const noteRef = (db, uid, id) => doc(db, `${notesPath(uid)}/${id}`);
const indexRef = (db, uid) => doc(db, `users/${uid}/noteIndex/summary`);

function toCloudNote(snapshotDoc) {
  const data = snapshotDoc.data();
  return {
    id: snapshotDoc.id,
    title: typeof data.title === "string" ? data.title : "",
    content: typeof data.content === "string" ? data.content : "",
    editedAt: typeof data.editedAt === "number" ? data.editedAt : 0,
    createdAtMs: data.createdAt?.toMillis?.() ?? 0,
  };
}

/**
 * 監聽這位使用者的所有雲端筆記。callback 收到 { notes, fromCache, hasPendingWrites }：
 * fromCache 為 true 代表資料不是伺服器的最新狀態（例如離線），呼叫端不能拿它判斷「某頁已被刪除」。
 */
export function subscribeNotes(db, uid, callback, onError) {
  return onSnapshot(
    collection(db, notesPath(uid)),
    (snapshot) => {
      callback({
        notes: snapshot.docs.map(toCloudNote),
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      });
    },
    onError,
  );
}

/**
 * 寫入一頁。已存在就更新；不存在就新增，並在同一個交易裡把計數加一（超過上限會丟 NoteLimitError）。
 * @returns {Promise<{created: boolean}>}
 */
export function saveNote(db, uid, { id, title, content, editedAt }) {
  return runTransaction(db, async (tx) => {
    const ref = noteRef(db, uid, id);
    const existing = await tx.get(ref);
    if (existing.exists()) {
      // 雲端已經有更晚編輯的版本（例如另一台裝置先送出）：不寫入，把雲端版本交還給呼叫端去合併，
      // 避免舊版本覆蓋新版本。規則也有同樣的限制（editedAt 只能前進）。
      const current = existing.data();
      if (typeof current.editedAt === "number" && current.editedAt > editedAt) {
        return { created: false, stale: true, cloud: toCloudNote(existing) };
      }
      tx.update(ref, { title, content, updatedAt: serverTimestamp(), editedAt });
      return { created: false };
    }
    const summary = await tx.get(indexRef(db, uid));
    const count = summary.exists() ? summary.data().count : 0;
    if (count >= NOTE_LIMITS.MAX_NOTES) throw new NoteLimitError();
    tx.set(ref, {
      title, content, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), editedAt,
    });
    tx.set(indexRef(db, uid), {
      count: count + 1, lastOp: "create", lastId: id, updatedAt: serverTimestamp(),
    });
    return { created: true };
  });
}

/** 刪除一頁，同一個交易裡把計數減一。雲端本來就沒有這一頁時什麼都不做。 */
export function deleteNote(db, uid, id) {
  return runTransaction(db, async (tx) => {
    const ref = noteRef(db, uid, id);
    const existing = await tx.get(ref);
    if (!existing.exists()) return { deleted: false };
    const summary = await tx.get(indexRef(db, uid));
    const count = summary.exists() ? summary.data().count : 1;
    tx.delete(ref);
    tx.set(indexRef(db, uid), {
      count: Math.max(count - 1, 0), lastOp: "delete", lastId: id, updatedAt: serverTimestamp(),
    });
    return { deleted: true };
  });
}

/** 直接問伺服器（不看快取）這一頁現在的內容。D-3 轉換圖片後用來確認真的寫進去、讀得回來。 */
export async function readNoteFromServer(db, uid, id) {
  const snapshot = await getDocFromServer(noteRef(db, uid, id));
  return snapshot.exists() ? toCloudNote(snapshot) : null;
}

/** 把 Firestore／網路錯誤分成同步流程需要的幾類。 */
export function classifyError(err) {
  if (err?.code === "note-limit") return "limit";
  const code = err?.code || "";
  if (code === "permission-denied") return "permission";
  if (["unavailable", "deadline-exceeded", "cancelled", "aborted", "resource-exhausted"].includes(code)) return "network";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  if (err?.name === "TypeError" || /network|offline|fetch/i.test(err?.message || "")) return "network";
  return "unknown";
}
