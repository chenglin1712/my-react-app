/**
 * 把 sharedNotes.createdAt 可能出現的幾種形狀統一轉成毫秒 epoch。
 *
 * 正常情況下這是 Firestore Timestamp（前端 SDK 物件，有 seconds/toDate()）。
 * 但正式資料裡有一批文件的 createdAt 已經退化成純 map
 * `{_seconds, _nanoseconds}`（不是 Timestamp）——推測是 import_firebase.py
 * 從備份 JSON 還原時，把某個匯出流程序列化出來的 map 原樣寫回 Firestore，
 * 沒有重建成真正的 Timestamp（見該檔案 _restore_timestamps() 的修正）。
 * 原本這裡只認 `ts.seconds`（沒有底線），讀不到 `_seconds`，
 * `(ts.seconds ? ... : ts) - 0` 會對一個 object 做減法變成 NaN，
 * /note/share 上每一張卡片因此顯示「NaN 天前」。
 *
 * 這裡屬於讀取端的防禦——即使補了資料遷移與匯入腳本的根因修正，舊資料
 * 遷移完成前、或任何未來又出現同類壞資料時，畫面也不該顯示 NaN。
 * 排序正不正確不是這個函式能修的（Firestore 的 orderBy 是伺服器端行為，
 * 要靠資料本身是不是真正的 Timestamp 決定），這裡只負責讓「顯示」不崩壞。
 */
function toMillis(ts) {
  if (ts == null) return null;
  // Firestore Timestamp（前端 SDK）：優先用 toDate()，比自己組
  // seconds*1000+nanoseconds/1e6 更不容易算錯精度。包一層 try/catch——
  // toDate() 是假設 ts 是真正的 Timestamp 才會有的方法，遇到偽造或損壞的
  // 物件（剛好也有一個叫 toDate 的屬性、但不是合法實作）時不該讓整個畫面
  // 崩潰（獨立審查覆核這批修正時提醒的邊界情況）。
  if (typeof ts.toDate === "function") {
    try {
      const date = ts.toDate();
      const ms = date instanceof Date ? date.getTime() : NaN;
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  }
  // 正常的 Timestamp-like 物件（seconds，沒有底線）。
  if (typeof ts.seconds === "number") {
    const ms = ts.seconds * 1000 + (ts.nanoseconds || 0) / 1e6;
    return Number.isFinite(ms) ? ms : null;
  }
  // 壞掉的 map 形狀（_seconds，有底線）——已知污染資料的實際樣子。
  if (typeof ts._seconds === "number") {
    const ms = ts._seconds * 1000 + (ts._nanoseconds || 0) / 1e6;
    return Number.isFinite(ms) ? ms : null;
  }
  // ISO 8601 字串或其他 Date 建構子看得懂的格式。
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // 毫秒 epoch 數字（Number.isFinite 同時擋掉 NaN 與 Infinity/-Infinity）。
  if (typeof ts === "number") {
    return Number.isFinite(ts) ? ts : null;
  }
  return null;
}

export function timeAgo(ts) {
  const ms = toMillis(ts);
  if (ms == null) return "";
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  if (hr < 24) return `${hr} 小時前`;
  if (day === 1) return "昨天";
  return `${day} 天前`;
}
