import { useEffect, useRef, useState } from "react";
import { fetchSharedNotesCount, fetchSharedNotesPage } from "../../userServives/noteService";

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
  const [refreshTick, setRefreshTick] = useState(0);

  // 每個 filter tab 各自的分頁快取：{ [filter]: { [page]: { notes, lastDoc, hasMore } } }
  const pageCacheRef = useRef({});

  const notesPerPage = 8;

  const fetchPage = async (f, page) => {
    if (f === "my" && !myUid) {
      setPageNotes([]);
      setHasMore(false);
      return;
    }
    setLoadingPage(true);
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
        filter: f, myUid, afterDoc, pageSize: notesPerPage,
      });

      pageCacheRef.current = {
        ...pageCacheRef.current,
        [f]: { ...cacheForFilter, [page]: { notes: pageRows, lastDoc, hasMore: more } },
      };
      setPageNotes(pageRows);
      setHasMore(more);
      setCurrentPage(page);
    } catch (e) {
      console.error("Fetch sharedNotes error:", e);
      setPageNotes([]);
      setHasMore(false);
    } finally {
      setLoadingPage(false);
    }
  };

  const fetchTotalCount = async (f) => {
    if (f === "my" && !myUid) {
      setTotalCount(0);
      return;
    }
    try {
      const count = await fetchSharedNotesCount({ filter: f, myUid });
      setTotalCount(count);
    } catch (e) {
      console.error("Fetch sharedNotes count error:", e);
      setTotalCount(null);
    }
  };

  // fetchPage/fetchTotalCount 每次渲染都重新建立，這裡只想在 filter／refreshTick／
  // myUid 真的變動時才重新抓，不想因為函式參照變了就多跑一次，用 ref 保存最新版本。
  const fetchPageRef = useRef(fetchPage);
  useEffect(() => {
    fetchPageRef.current = fetchPage;
  });
  const fetchTotalCountRef = useRef(fetchTotalCount);
  useEffect(() => {
    fetchTotalCountRef.current = fetchTotalCount;
  });

  // 切換 tab／重新整理／登入狀態改變：清空分頁快取，從第 1 頁重新抓
  useEffect(() => {
    pageCacheRef.current = {};
    fetchPageRef.current(filter, 1);
    fetchTotalCountRef.current(filter);
  }, [filter, refreshTick, myUid]);

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

  const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / notesPerPage)) : null;

  return {
    pageNotes, setPageNotes,
    currentPage, hasMore, totalPages, loadingPage,
    goToPage, refresh, updateCurrentPageCache,
    // 刪除筆記後由呼叫端樂觀遞減，不用整份重新查一次總筆數
    decrementTotalCount: () => setTotalCount((prev) => (prev != null ? Math.max(0, prev - 1) : prev)),
  };
}
