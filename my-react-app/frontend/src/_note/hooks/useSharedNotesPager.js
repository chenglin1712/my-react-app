import { useCallback, useEffect, useRef, useState } from "react";
import { fetchSharedNotesCount, fetchSharedNotesPage } from "../../userServives/noteService";

const NOTES_PER_PAGE = 8;

/**
 * sharedNotes 的分頁狀態機：依 filter tab 游標分頁查詢＋每個 tab 各自的分頁快取
 * （上一頁/下一頁在已經看過的頁面之間切換時直接用快取，不用重新查詢 Firestore）、
 * 以及對應的總筆數查詢。從 noteshare.jsx 抽出來，讓頁面元件不用管分頁/快取細節。
 */
export function useSharedNotesPager(filter, myUid) {
  const [pageNotes, setPageNotes] = useState([]); // 目前這一頁的筆記（未經關鍵字篩選）
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // 每個 filter tab 各自的分頁快取：{ [filter]: { [page]: { notes, lastDoc, hasMore } } }
  const pageCacheRef = useRef({});

  // 快速切換 tab／連續翻頁時，較慢的舊請求可能比新請求晚回來——generation
  // 讓每次呼叫記住「我是不是當下最新的那一次」，舊的回應到達時就直接丟棄，
  // 不覆蓋畫面已經顯示的新結果（page 與 count 是兩條獨立的請求，各自记一個）。
  const pageGenerationRef = useRef(0);
  const countGenerationRef = useRef(0);

  const fetchPage = useCallback(async (f, page) => {
    const myGeneration = ++pageGenerationRef.current;
    if (f === "my" && !myUid) {
      setPageNotes([]);
      setHasMore(false);
      return;
    }
    setLoadingPage(true);
    setPageError(null);
    try {
      const cacheForFilter = pageCacheRef.current[f] || {};
      const cached = cacheForFilter[page];
      if (cached) {
        // 這一頁之前看過，直接用快取，不用再查一次 Firestore
        setPageNotes(cached.notes);
        setHasMore(cached.hasMore);
        setCurrentPage(page);
        return;
      }

      let afterDoc;
      if (page !== 1) {
        const prevPage = cacheForFilter[page - 1];
        if (!prevPage) return; // 只能逐頁往前推進，上一頁必定已在快取中
        afterDoc = prevPage.lastDoc;
      }

      const { notes: pageRows, hasMore: more, lastDoc } = await fetchSharedNotesPage({
        filter: f, myUid, afterDoc, pageSize: NOTES_PER_PAGE,
      });

      if (myGeneration !== pageGenerationRef.current) return; // 已經有更新的請求，這次結果不算數

      pageCacheRef.current = {
        ...pageCacheRef.current,
        [f]: { ...cacheForFilter, [page]: { notes: pageRows, lastDoc, hasMore: more } },
      };
      setPageNotes(pageRows);
      setHasMore(more);
      setCurrentPage(page);
    } catch (e) {
      if (myGeneration !== pageGenerationRef.current) return;
      console.error("Fetch sharedNotes error:", e);
      setPageNotes([]);
      setHasMore(false);
      setPageError("讀取筆記失敗，請稍後再試。");
    } finally {
      if (myGeneration === pageGenerationRef.current) setLoadingPage(false);
    }
  }, [myUid]);

  const fetchTotalCount = useCallback(async (f) => {
    const myGeneration = ++countGenerationRef.current;
    if (f === "my" && !myUid) {
      setTotalCount(0);
      return;
    }
    try {
      const count = await fetchSharedNotesCount({ filter: f, myUid });
      if (myGeneration !== countGenerationRef.current) return;
      setTotalCount(count);
    } catch (e) {
      if (myGeneration !== countGenerationRef.current) return;
      console.error("Fetch sharedNotes count error:", e);
      setTotalCount(null);
    }
  }, [myUid]);

  // 切換 tab／重新整理／登入狀態改變：清空分頁快取，從第 1 頁重新抓
  useEffect(() => {
    pageCacheRef.current = {};
    fetchPage(filter, 1);
    fetchTotalCount(filter);
  }, [filter, refreshTick, myUid, fetchPage, fetchTotalCount]);

  const goToPage = (page) => {
    if (page < 1 || loadingPage) return;
    if (page > currentPage && !hasMore) return;
    fetchPage(filter, page);
  };

  const refresh = () => setRefreshTick((x) => x + 1);

  // 讚數／刪除這種對單筆筆記的局部更新，同步寫回目前頁面的快取，
  // 避免使用者切到別頁再切回來時看到刷新前的舊資料
  const updateCurrentPageCache = (updater) => {
    const cacheForFilter = pageCacheRef.current[filter];
    const cached = cacheForFilter?.[currentPage];
    if (!cached) return;
    pageCacheRef.current = {
      ...pageCacheRef.current,
      [filter]: {
        ...cacheForFilter,
        [currentPage]: { ...cached, notes: updater(cached.notes) },
      },
    };
  };

  const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / NOTES_PER_PAGE)) : null;

  return {
    pageNotes, setPageNotes,
    currentPage, hasMore, totalPages, loadingPage, pageError,
    goToPage, refresh, updateCurrentPageCache,
    // 刪除筆記後由呼叫端樂觀遞減，不用整份重新查一次總筆數
    decrementTotalCount: () => setTotalCount((prev) => (prev != null ? Math.max(0, prev - 1) : prev)),
  };
}
