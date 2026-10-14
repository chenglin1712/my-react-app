/**
 * 雲端同步的本機紀錄（每個帳號一份，存在 localStorage）。
 *
 * - synced         { [id]: 上次成功同步時的 editedAt }
 * - pendingDeletes [id] 使用者在這裡刪除、還沒從雲端刪掉的頁
 * - failed         { [id]: { code, message, editedAt } } 同步失敗的頁（本機副本都還在）
 * - migrated       首次把本機舊筆記上傳到雲端的流程是否已經完整做完（沒有失敗的頁）
 *
 * 這份紀錄不是筆記本身，壞掉或遺失時最壞的結果是「所有頁被當成沒同步過」，
 * 之後會重新比對一次，不會遺失筆記內容。
 */

export const metaKey = (uid) => `userNotesSync_${uid}`;

export function emptyMeta() {
  return { v: 1, synced: {}, pendingDeletes: [], failed: {}, migrated: false };
}

const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

export function loadMeta(uid) {
  try {
    const raw = localStorage.getItem(metaKey(uid));
    if (!raw) return emptyMeta();
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return emptyMeta();
    return {
      v: 1,
      synced: isPlainObject(parsed.synced) ? parsed.synced : {},
      pendingDeletes: Array.isArray(parsed.pendingDeletes) ? parsed.pendingDeletes.filter((x) => typeof x === 'string') : [],
      failed: isPlainObject(parsed.failed) ? parsed.failed : {},
      migrated: parsed.migrated === true,
    };
  } catch {
    return emptyMeta();
  }
}

export function saveMeta(uid, meta) {
  try {
    localStorage.setItem(metaKey(uid), JSON.stringify(meta));
    return true;
  } catch (e) {
    console.error('儲存同步紀錄失敗：', e);
    return false;
  }
}
