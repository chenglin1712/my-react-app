/**
 * 雲端筆記同步的純邏輯（D-2／D-3）：沒有任何 I/O、不碰 React，輸入本機筆記、雲端筆記與
 * 同步紀錄，輸出「本機該變成什麼、要上傳哪些頁、要從雲端刪哪些頁、要提示使用者什麼」。
 * 刻意獨立出來，是因為多裝置衝突的每個分支都需要被窮舉測試，而這些分支用 Firestore 與
 * 計時器去測既慢又容易漏。
 *
 * 名詞：
 * - 本機筆記 { id, title, content, editedAt? }：editedAt 是使用者在這個裝置上最後編輯的
 *   時間（毫秒）。只有雲端同步開啟後才會寫入；沒有 editedAt 的舊筆記視為 0。
 * - 雲端筆記 { id, title, content, editedAt, createdAtMs }。
 * - 同步紀錄 meta：
 *     synced        { [id]: 上次成功同步時的 editedAt }，有值代表「這一頁雲端和這個裝置同步過」。
 *     pendingDeletes [id]，使用者在這裡明確刪除、還沒從雲端刪掉的頁。
 *
 * 刪除一律「明確」才會影響雲端：只有使用者按了刪除（記進 pendingDeletes）才會刪雲端的頁。
 * 本機筆記因為任何原因不見（localStorage 損毀被重置、清除網站資料後只剩同步紀錄）時，
 * 雲端那一頁只會被當成「別的裝置新增的」拉回來，而不是被當成刪除，避免一次意外清空整個雲端。
 */

export const NOTE_LIMITS = {
  TITLE_CHARS: 100,
  // 單頁 100 KB 的位元組檢查在這裡做；Firestore 規則只能數字元（100,000），是後盾（見 firestore.rules）。
  CONTENT_BYTES: 100 * 1024,
  CONTENT_CHARS: 100000,
  MAX_NOTES: 200,
};

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function byteLength(text) {
  if (encoder) return encoder.encode(text).length;
  // 沒有 TextEncoder 的環境：保守估成每字元最多 4 位元組
  return text.length * 4;
}

export function noteTitle(note) {
  return note?.title?.trim() || '未命名筆記';
}

/** 完全空白的筆記（沒有標題、沒有文字、沒有圖片）。這種頁不上傳，也不需要保留。 */
export function isBlankNote(note) {
  if (!note) return true;
  if (note.title && note.title.trim() !== '') return false;
  const content = note.content || '';
  // 只有這些純排版標籤、而且沒有文字才算空白；出現其他任何標籤（圖片、影片、分隔線、嵌入內容…）一律視為有內容，
  // 避免把使用者的內容當成「沒用過的空白頁」清掉。
  const withoutLayoutTags = content.replace(/<\/?(p|br|div|span|strong|em|b|i|u)\b[^>]*>/gi, '');
  if (/<[a-z]/i.test(withoutLayoutTags)) return false;
  return withoutLayoutTags.replace(/&nbsp;/gi, ' ').trim() === '';
}

/**
 * 寫到雲端之前的大小檢查。回傳 null 代表沒問題，否則 { code, message }。
 * 位元組以 UTF-8 計：中文每字 3 位元組、emoji 4 位元組。
 */
export function validateForCloud(note) {
  const title = note?.title || '';
  const content = note?.content || '';
  if ([...title].length > NOTE_LIMITS.TITLE_CHARS) {
    return { code: 'title_too_long', message: `標題超過 ${NOTE_LIMITS.TITLE_CHARS} 個字，請縮短後再同步。` };
  }
  if (content.length > NOTE_LIMITS.CONTENT_CHARS || byteLength(content) > NOTE_LIMITS.CONTENT_BYTES) {
    return { code: 'content_too_large', message: '這一頁內容超過 100 KB，無法同步到雲端，請拆成多頁或移除部分內容。' };
  }
  return null;
}

/** 內容裡有沒有內嵌的 Base64 圖片（舊版筆記的做法，會讓單頁輕易超過大小上限）。 */
export function hasDataImages(content) {
  return /<img\b[^>]*\bsrc\s*=\s*["']data:image\//i.test(content || '');
}

function sameNote(local, cloud) {
  return (local.title || '') === (cloud.title || '') && (local.content || '') === (cloud.content || '');
}

function fromCloud(cloud) {
  return { id: cloud.id, title: cloud.title || '', content: cloud.content || '<p></p>', editedAt: cloud.editedAt };
}

/** 哪些本機頁還有沒送上去的修改。failed 紀錄過、且之後沒再編輯的頁先略過，避免一直重試同一個失敗。 */
export function findUnsyncedIds(local, meta) {
  const synced = meta?.synced || {};
  const failed = meta?.failed || {};
  const ids = [];
  for (const note of local) {
    if (isBlankNote(note)) continue;
    const edited = note.editedAt || 0;
    const base = synced[note.id];
    const unsynced = base === undefined || edited > base;
    if (!unsynced) continue;
    const failure = failed[note.id];
    if (failure && edited <= (failure.editedAt || 0)) continue;
    ids.push(note.id);
  }
  return ids;
}

/**
 * 比對本機與雲端。
 *
 * @returns {{
 *   local: object[],        比對後本機應有的筆記（順序：既有的維持原順序，雲端新增的接在後面）
 *   changed: boolean,       local 是否和輸入不同
 *   changedIds: string[],   內容被雲端版本覆蓋或新增的頁（編輯器可能需要重新載入）
 *   toPush: string[],       需要上傳的頁 id
 *   toDelete: string[],     需要從雲端刪除的頁 id（使用者在本機明確刪除的）
 *   markSynced: object,     { id: editedAt } 這些頁現在確定和雲端一致
 *   forgetSynced: string[], 不再視為同步過的頁
 *   clearPending: string[], 已經不需要再刪的 pendingDeletes
 *   notices: {kind,id,message}[]
 * }}
 */
export function reconcile({ local, cloud, meta, now = Date.now() }) {
  const synced = meta?.synced || {};
  const pending = new Set(meta?.pendingDeletes || []);
  const cloudById = new Map(cloud.map((c) => [c.id, c]));
  const localIds = new Set(local.map((n) => n.id));

  const out = {
    local: [], changed: false, changedIds: [], toPush: [], toDelete: [],
    markSynced: {}, forgetSynced: [], clearPending: [], notices: [],
  };
  const notice = (kind, note, message) => out.notices.push({ kind, id: note.id, message });
  const takeCloud = (c) => { out.markSynced[c.id] = c.editedAt; out.changedIds.push(c.id); out.changed = true; return fromCloud(c); };

  for (const note of local) {
    const c = cloudById.get(note.id);
    const edited = note.editedAt || 0;
    const base = synced[note.id];

    if (!c) {
      if (base !== undefined && !pending.has(note.id)) {
        // 同步過、現在雲端沒有：被其他裝置刪除了。
        out.forgetSynced.push(note.id);
        if (edited > base) {
          out.local.push(note);
          out.toPush.push(note.id);
          notice('kept-after-remote-delete', note, `「${noteTitle(note)}」已在另一個裝置刪除，但你在這裡有新的修改，已為你保留並重新上傳。`);
        } else {
          out.changed = true;
          notice('remote-deleted', note, `「${noteTitle(note)}」已在另一個裝置刪除，這個裝置也已移除。`);
        }
        continue;
      }
      if (pending.has(note.id)) out.clearPending.push(note.id);
      out.local.push(note);
      if (!isBlankNote(note)) out.toPush.push(note.id);
      continue;
    }

    // 兩邊都有
    if (sameNote(note, c)) {
      // 內容一樣：編輯時間取較晚的，延遲抵達的舊快照不能把本機的編輯時間往回改。
      const latest = Math.max(edited, c.editedAt);
      out.markSynced[note.id] = latest;
      if (note.editedAt !== latest) {
        out.local.push({ ...note, editedAt: latest });
        out.changed = true;
      } else {
        out.local.push(note);
      }
      continue;
    }

    // 雲端比上次同步時更新，才算「雲端有變動」；比紀錄更舊的雲端版本是延遲抵達的舊資料，忽略。
    const cloudChanged = base === undefined || c.editedAt > base;
    // 本機有沒送出的修改。編輯時間沒動、但內容和雲端不同（例如同步關閉期間改過）也當成有修改。
    const dirty = base === undefined || edited > base || !cloudChanged;

    if (!dirty && cloudChanged) {
      out.local.push(takeCloud(c));
    } else if (dirty && !cloudChanged) {
      const stamped = edited > base ? note : { ...note, editedAt: now };
      if (stamped !== note) out.changed = true;
      out.local.push(stamped);
      out.toPush.push(note.id);
    } else if (c.editedAt > edited) {
      // 兩邊都改過：以較晚編輯的為準。
      out.local.push(takeCloud(c));
      notice('conflict-cloud-won', note, `「${noteTitle(note)}」在另一個裝置有較新的修改，已更新為較新的版本。`);
    } else {
      out.local.push(note);
      out.toPush.push(note.id);
      notice('conflict-local-won', note, `「${noteTitle(note)}」在另一個裝置也被修改過，已保留這個裝置較新的版本。`);
    }
  }

  // 只在雲端有的頁
  const cloudOnly = cloud
    .filter((c) => !localIds.has(c.id))
    .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0) || (a.id < b.id ? -1 : 1));
  for (const c of cloudOnly) {
    if (pending.has(c.id)) {
      out.toDelete.push(c.id);
    } else {
      out.local.push(takeCloud(c));
    }
  }
  for (const id of pending) {
    if (!cloudById.has(id)) out.clearPending.push(id);
  }

  // 有其他筆記時，拿掉沒上傳過的空白頁（新帳號預設的那張空白筆記），至少留一頁。
  if (out.local.length > 1) {
    const kept = out.local.filter((n) => !(isBlankNote(n) && synced[n.id] === undefined && !cloudById.has(n.id)));
    if (kept.length !== out.local.length) {
      out.changed = true;
      out.local = kept.length ? kept : [out.local[0]];
    }
  }

  return out;
}
