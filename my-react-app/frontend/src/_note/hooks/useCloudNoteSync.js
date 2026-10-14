import { useCallback, useEffect, useRef, useState } from 'react';
import * as defaultRepo from '../sync/cloudNotesRepo';
import { uploadToCloudinary } from '@utils/uploadToCloudinary';
import { convertDataImages, ImageConvertError } from '../sync/convertDataImages';
import {
  findUnsyncedIds, hasDataImages, isBlankNote, reconcile, validateForCloud,
} from '../sync/noteSyncCore';
import { emptyMeta, loadMeta, saveMeta } from '../sync/noteSyncMeta';

const DEBOUNCE_MS = 2000;
const BACKOFF_MS = [5000, 15000, 30000, 60000];

const defaultUpload = (blob) => uploadToCloudinary(blob, { folder: 'tayal_note', transform: false });

/**
 * 讓一輪同步停下來。
 * - network：網路中斷，稍後重試。
 * - stale：這一輪已經過期（換了帳號、旗標被關掉），什麼都不要再做，也不要碰任何狀態。
 */
class CycleAbort extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const FAILURE_MESSAGES = {
  title_too_long: '標題超過 100 個字。',
  content_too_large: '內容超過 100 KB。',
  limit: '雲端筆記最多 200 頁，這一頁還沒上傳。',
  image_too_big: '內含的圖片超過 5 MB，無法轉成網址。',
  image_upload: '內含的圖片上傳失敗，請檢查網路後重試。',
  image_decode: '內含的圖片資料無法讀取。',
  verify: '上傳後無法確認雲端內容，已保留這個裝置上的版本。',
  permission: '雲端拒絕了這一頁的寫入（可能是裝置的日期時間不正確，或雲端規則尚未更新）。',
  unknown: '同步時發生未預期的錯誤。',
};

/**
 * 雲端筆記同步（D-2／D-3）。本機（localStorage）永遠是第一手的資料，雲端是備份與跨裝置的來源：
 * - 停止輸入約 2 秒後把有修改的頁寫上雲端；離開頁面、切到背景時立刻寫。
 * - 即時監聽雲端：別的裝置的修改會合併進來，兩邊都改同一頁以最後編輯的為準並提示（見 noteSyncCore）。
 * - 第一次開啟時，把本機舊筆記一頁一頁上傳；內嵌的 Base64 圖片先轉成 Cloudinary 網址。
 *   轉換、上傳、從伺服器讀回確認都成功之前，本機副本完全不動；失敗的頁面留在本機並標示，可重試與匯出。
 *
 * 每次啟動（換帳號、旗標開關）都有一個新的「世代」。一輪同步開始時把帳號、連線、同步紀錄都抓在自己手上，
 * 每個 await 之後確認世代沒變；世代變了就直接放棄，絕不會把舊帳號的資料寫到新帳號底下。
 *
 * @returns {{
 *   status: 'off'|'connecting'|'saving'|'synced'|'offline'|'error',
 *   lastSyncedAt: number|null, progress: {done:number,total:number}|null,
 *   notices: {key:number,kind:string,id:string,message:string}[],
 *   failures: {id:string,code:string,message:string}[],
 *   dismissNotice: Function, dismissAllNotices: Function, retry: Function, retryAll: Function,
 *   recordDelete: Function,
 * }}
 */
export function useCloudNoteSync({
  uid, enabled, db, notes, getNotes, flushEditor, applyExternalChange, subscribeEdit,
  repo = defaultRepo, upload = defaultUpload, now = Date.now, debounceMs = DEBOUNCE_MS,
}) {
  const active = Boolean(enabled && uid && uid !== 'guest' && db);

  const [status, setStatus] = useState('off');
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [progress, setProgress] = useState(null);
  const [notices, setNotices] = useState([]);
  const [failedMap, setFailedMap] = useState({});

  const metaRef = useRef(emptyMeta());
  const cloudRef = useRef(null); // Map<id, cloudNote>；null 代表還沒收到第一份雲端快照
  const genRef = useRef(0);
  const timerRef = useRef(null);
  const retryAttemptRef = useRef(0);
  const runningRef = useRef(false);
  const rerunRef = useRef(false);
  const inFlightRef = useRef(new Set()); // 正在上傳中的頁 id（上傳途中被刪除要能補刪雲端那一份）
  const imageCacheRef = useRef(new Map());
  const noticeKeyRef = useRef(0);
  const runCycleRef = useRef(() => {});

  // 計時器與事件處理器是長壽命的閉包，用 ref 讀最新的相依。
  // ref 只能在 effect 裡更新（不能在 render 中）；這個 effect 必須排在下面所有 effect 之前。
  const deps = useRef({});
  useEffect(() => {
    deps.current = {
      uid, db, repo, upload, now, debounceMs, getNotes, flushEditor, applyExternalChange, active,
    };
  });

  const alive = useCallback((ctx) => genRef.current === ctx.gen && deps.current.active, []);
  const assertAlive = useCallback((ctx) => {
    if (!alive(ctx)) throw new CycleAbort('stale');
  }, [alive]);

  const commitMeta = useCallback((ctx) => {
    saveMeta(ctx.uid, ctx.meta);
    if (alive(ctx)) setFailedMap({ ...ctx.meta.failed });
  }, [alive]);

  const pushNotice = useCallback((ctx, items) => {
    if (!items.length || !alive(ctx)) return;
    setNotices((prev) => [
      ...prev,
      ...items.map((item) => ({ ...item, key: (noticeKeyRef.current += 1) })),
    ]);
  }, [alive]);

  const schedule = useCallback((ms) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runCycleRef.current(), ms);
  }, []);

  const recordFailure = useCallback((ctx, note, code, message) => {
    ctx.meta.failed[note.id] = {
      code, message: message || FAILURE_MESSAGES[code] || FAILURE_MESSAGES.unknown, editedAt: note.editedAt || 0,
    };
  }, []);

  /** 網路問題讓整輪停下來等重試；其餘（權限、上限、未知）只記在這一頁，其他頁照常同步。 */
  const handleOperationError = useCallback((ctx, err, note) => {
    const kind = ctx.repo.classifyError ? ctx.repo.classifyError(err) : 'unknown';
    if (kind === 'network') throw new CycleAbort('network');
    if (kind === 'limit') {
      recordFailure(ctx, note, 'limit');
    } else if (kind === 'permission') {
      recordFailure(ctx, note, 'permission');
    } else {
      console.error('雲端筆記同步失敗：', err);
      recordFailure(ctx, note, 'unknown');
    }
  }, [recordFailure]);

  /** @returns {Promise<'ok'|'skipped'|'failed'|'stale'>} */
  const pushOne = useCallback(async (ctx, id) => {
    const { uid: u, db: database, repo: r, upload: up, now: clock, meta } = ctx;
    const readNote = () => deps.current.getNotes().find((n) => n.id === id);
    let note = readNote();
    if (!note || isBlankNote(note)) return 'skipped';

    // 舊筆記沒有編輯時間：用第一次要上傳的當下補上，並存回本機，之後就固定不變。
    if (!note.editedAt) {
      const stamped = clock();
      deps.current.applyExternalChange(
        (prev) => prev.map((n) => (n.id === id && !n.editedAt ? { ...n, editedAt: stamped } : n)),
        { refreshEditor: false },
      );
      note = readNote() || { ...note, editedAt: stamped };
    }

    inFlightRef.current.add(id);
    try {
      let content = note.content || '<p></p>';
      const converted = hasDataImages(content);
      if (converted) {
        try {
          ({ content } = await convertDataImages(content, { upload: up, cache: imageCacheRef.current }));
        } catch (err) {
          if (!(err instanceof ImageConvertError)) throw err;
          assertAlive(ctx);
          console.error('筆記圖片轉換失敗：', err);
          recordFailure(ctx, note, `image_${err.code === 'too_big' ? 'too_big' : err.code === 'decode' ? 'decode' : 'upload'}`);
          return 'failed';
        }
        assertAlive(ctx);
      }

      const check = validateForCloud({ title: note.title, content });
      if (check) {
        recordFailure(ctx, note, check.code, check.message);
        return 'failed';
      }

      // 轉圖片可能花了一段時間：送出前再確認這一頁還在（使用者可能已經刪掉）
      assertAlive(ctx);
      if (!readNote()) return 'skipped';

      let saved;
      try {
        saved = await r.saveNote(database, u, { id, title: note.title || '', content, editedAt: note.editedAt });
      } catch (err) {
        assertAlive(ctx);
        handleOperationError(ctx, err, note);
        return 'failed';
      }
      assertAlive(ctx);

      if (saved?.stale) {
        // 雲端已經有更晚編輯的版本，沒有寫入。把雲端版本記下來，下一輪比對時會取較新的那份。
        cloudRef.current?.set(id, saved.cloud);
        rerunRef.current = true;
        return 'stale';
      }

      meta.synced[id] = note.editedAt;
      delete meta.failed[id];
      cloudRef.current?.set(id, {
        id, title: note.title || '', content, editedAt: note.editedAt, createdAtMs: 0,
      });

      if (!readNote()) {
        // 上傳的途中使用者刪除了這一頁：雲端剛建立的那一份要補刪掉，不然會被當成別台裝置新增的又拉回來。
        if (!meta.pendingDeletes.includes(id)) meta.pendingDeletes.push(id);
        rerunRef.current = true;
        return 'ok';
      }

      if (converted) {
        // 轉換過圖片的頁：從伺服器讀回來確認內容真的在雲端，才把本機副本換成網址版本。
        let server;
        try {
          server = await r.readNoteFromServer(database, u, id);
        } catch (err) {
          assertAlive(ctx);
          handleOperationError(ctx, err, note);
          return 'failed';
        }
        assertAlive(ctx);
        if (!server || server.content !== content || server.title !== (note.title || '')) {
          recordFailure(ctx, note, 'verify');
          return 'failed';
        }
        const original = note.content;
        deps.current.applyExternalChange((prev) => {
          let changed = false;
          const next = prev.map((n) => {
            if (n.id === id && n.content === original) { changed = true; return { ...n, content }; }
            return n;
          });
          return changed ? next : prev;
        }, { refreshEditor: false });
      }
      return 'ok';
    } finally {
      inFlightRef.current.delete(id);
    }
  }, [assertAlive, handleOperationError, recordFailure]);

  const cycleOnce = useCallback(async () => {
    if (!deps.current.active || !cloudRef.current) return;
    // 這一輪要用到的東西一開始就抓在自己手上，不再回頭讀會被換掉的共用變數。
    const ctx = {
      gen: genRef.current,
      uid: deps.current.uid,
      db: deps.current.db,
      repo: deps.current.repo,
      upload: deps.current.upload,
      now: deps.current.now,
      meta: metaRef.current,
    };
    const { meta } = ctx;

    let local;
    try {
      local = deps.current.flushEditor();
    } catch {
      local = deps.current.getNotes();
    }

    const result = reconcile({ local, cloud: [...cloudRef.current.values()], meta, now: ctx.now() });
    if (result.changed) deps.current.applyExternalChange(() => result.local);
    Object.assign(meta.synced, result.markSynced);
    result.forgetSynced.forEach((id) => { delete meta.synced[id]; delete meta.failed[id]; });
    if (result.clearPending.length) {
      meta.pendingDeletes = meta.pendingDeletes.filter((id) => !result.clearPending.includes(id));
    }
    pushNotice(ctx, result.notices);

    // 要上傳的頁：比對出來的 ＋ 本機還沒送出去的修改（失敗過且之後沒再編輯的先略過）
    const byId = new Map(result.local.map((n) => [n.id, n]));
    const unsynced = new Set(findUnsyncedIds(result.local, meta));
    const pushIds = [...new Set([...result.toPush.filter((id) => unsynced.has(id)), ...unsynced])]
      .filter((id) => byId.has(id));
    const deleteIds = result.toDelete;

    if (deleteIds.length + pushIds.length === 0) {
      commitMeta(ctx);
      return;
    }

    if (alive(ctx)) setStatus('saving');
    const migrating = !meta.migrated && pushIds.length > 0;
    if (migrating && alive(ctx)) setProgress({ done: 0, total: pushIds.length });

    let allDone = false;
    try {
      for (const id of deleteIds) {
        assertAlive(ctx);
        try {
          await ctx.repo.deleteNote(ctx.db, ctx.uid, id);
        } catch (err) {
          assertAlive(ctx);
          handleOperationError(ctx, err, { id, editedAt: 0 });
          continue;
        }
        assertAlive(ctx);
        cloudRef.current?.delete(id);
        delete meta.synced[id];
        meta.pendingDeletes = meta.pendingDeletes.filter((x) => x !== id);
        delete meta.failed[id];
      }
      let done = 0;
      for (const id of pushIds) {
        assertAlive(ctx);
        await pushOne(ctx, id);
        done += 1;
        if (migrating && alive(ctx)) setProgress({ done, total: pushIds.length });
      }
      allDone = true;
    } finally {
      // 這一輪過期了（換帳號、旗標關閉）就不再碰任何狀態；同步紀錄屬於當時的帳號，照實存回去。
      commitMeta(ctx);
      if (alive(ctx)) setProgress(null);
    }

    if (allDone && alive(ctx)) {
      // 已經不存在的頁，失敗紀錄也一併清掉
      const liveIds = new Set(deps.current.getNotes().map((n) => n.id));
      Object.keys(meta.failed).forEach((id) => { if (!liveIds.has(id)) delete meta.failed[id]; });
      if (!meta.migrated && Object.keys(meta.failed).length === 0) meta.migrated = true;
      commitMeta(ctx);
    }
  }, [alive, assertAlive, commitMeta, handleOperationError, pushNotice, pushOne]);

  const runCycle = useCallback(async () => {
    if (!deps.current.active) return;
    if (runningRef.current) {
      rerunRef.current = true;
      return;
    }
    runningRef.current = true;
    try {
      do {
        rerunRef.current = false;
        const gen = genRef.current;
        try {
          await cycleOnce();
          if (gen !== genRef.current) continue;
          retryAttemptRef.current = 0;
          if (cloudRef.current && deps.current.active) {
            setStatus('synced');
            setLastSyncedAt(deps.current.now());
          }
        } catch (err) {
          if (err instanceof CycleAbort && err.reason === 'stale') {
            rerunRef.current = deps.current.active; // 新的世代還要跑一輪
          } else if (gen !== genRef.current) {
            continue;
          } else if (err instanceof CycleAbort) {
            setStatus('offline');
            schedule(BACKOFF_MS[Math.min(retryAttemptRef.current, BACKOFF_MS.length - 1)]);
            retryAttemptRef.current += 1;
          } else {
            console.error('雲端筆記同步失敗：', err);
            setStatus('error');
          }
        }
      } while (rerunRef.current);
    } finally {
      runningRef.current = false;
    }
  }, [cycleOnce, schedule]);
  useEffect(() => {
    runCycleRef.current = runCycle;
  }, [runCycle]);

  // 離開筆記頁：把還沒送出的修改立刻送一次（盡力而為，本機副本本來就在）。
  // 這個 effect 必須排在下面訂閱雲端的 effect 之前：卸載時它的清理函式要先跑，才不會被新世代的判斷擋掉。
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    runCycleRef.current();
  }, []);

  // 訂閱雲端、綁定各種觸發時機。每次執行（換帳號、旗標開關）都是一個新的世代，舊世代進行中的同步會自己放棄。
  useEffect(() => {
    genRef.current += 1;
    clearTimeout(timerRef.current);
    cloudRef.current = null;
    retryAttemptRef.current = 0;
    if (!active) {
      setStatus('off');
      setProgress(null);
      return undefined;
    }
    metaRef.current = loadMeta(uid);
    setFailedMap({ ...metaRef.current.failed });
    setStatus('connecting');

    const unsubscribe = deps.current.repo.subscribeNotes(
      db,
      uid,
      (snapshot) => {
        // 快取資料不是伺服器的最新狀態（例如離線），不能拿來判斷「某頁已被刪除」。
        if (snapshot.fromCache) {
          if (!cloudRef.current) setStatus('offline');
          return;
        }
        // 自己剛寫的、伺服器還沒確認的變動先不處理，等確認後再比對。
        if (snapshot.hasPendingWrites) return;
        cloudRef.current = new Map(snapshot.notes.map((n) => [n.id, n]));
        retryAttemptRef.current = 0;
        schedule(0);
      },
      (err) => {
        const kind = deps.current.repo.classifyError ? deps.current.repo.classifyError(err) : 'unknown';
        setStatus(kind === 'permission' ? 'error' : 'offline');
      },
    );
    const unsubscribeEdit = subscribeEdit(() => schedule(deps.current.debounceMs));

    const flushNow = () => { clearTimeout(timerRef.current); runCycleRef.current(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushNow(); };
    const onOnline = () => { retryAttemptRef.current = 0; schedule(0); };
    const onOffline = () => setStatus('offline');
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribe?.();
      unsubscribeEdit?.();
      window.removeEventListener('pagehide', flushNow);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, uid, db, schedule, subscribeEdit]);

  // 筆記內容（含標題）有變動：有還沒同步的頁就排一次「停止輸入後」的同步
  useEffect(() => {
    if (!active || !cloudRef.current) return;
    if (findUnsyncedIds(notes, metaRef.current).length > 0) schedule(deps.current.debounceMs);
  }, [active, notes, schedule]);

  // 卸載時清掉計時器
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const recordDelete = useCallback((id) => {
    if (!deps.current.active) return;
    const meta = metaRef.current;
    // 同步過的頁，或正在上傳中的頁（上傳完成後雲端就有了）都要記下來補刪
    if (meta.synced[id] === undefined && !inFlightRef.current.has(id)) return;
    if (!meta.pendingDeletes.includes(id)) meta.pendingDeletes.push(id);
    saveMeta(deps.current.uid, meta);
    schedule(deps.current.debounceMs);
  }, [schedule]);

  const retry = useCallback((id) => {
    delete metaRef.current.failed[id];
    saveMeta(deps.current.uid, metaRef.current);
    setFailedMap({ ...metaRef.current.failed });
    schedule(0);
  }, [schedule]);

  const retryAll = useCallback(() => {
    metaRef.current.failed = {};
    saveMeta(deps.current.uid, metaRef.current);
    setFailedMap({});
    schedule(0);
  }, [schedule]);

  const dismissNotice = useCallback((key) => setNotices((prev) => prev.filter((n) => n.key !== key)), []);
  const dismissAllNotices = useCallback(() => setNotices([]), []);

  const failures = Object.entries(failedMap).map(([id, f]) => ({ id, code: f.code, message: f.message }));

  return {
    status, lastSyncedAt, progress, notices, failures,
    dismissNotice, dismissAllNotices, retry, retryAll, recordDelete,
  };
}
