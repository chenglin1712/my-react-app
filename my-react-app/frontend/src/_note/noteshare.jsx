import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc, getDocs, getDoc, updateDoc, collection, query, where, orderBy, limit, startAfter,
  getCountFromServer,
} from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../src/userServives/authContext";
import "../../static/css/_note/./notesharestyle.css";
import { Heart } from "lucide-react"
import DOMPurify from "dompurify";
import TabSwitch from "../../components/ui/TabSwitch";

function timeAgo(ts) {
  if (!ts) return "";
  const ms = (ts.seconds ? ts.seconds * 1000 : ts) - 0;
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

// 分頁 tab 對應的 Firestore orderBy 欄位（sharedNotes 建立時一律會寫入
// createdAt/likes，見 _note/index.jsx 的 addDoc，故 orderBy 不會漏掉正常建立的筆記）
const SORT_FIELD = { latest: "createdAt", hot: "likes", my: "createdAt" };

export default function NoteShare() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userData } = useAuth();

  const [pageNotes, setPageNotes] = useState([]); // 目前這一頁的筆記（未經關鍵字篩選）
  const [filter, setFilter] = useState("latest"); // latest | hot | my
  const [keyword, setKeyword] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalNote, setModalNote] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // 每個 filter tab 各自的分頁快取：{ [filter]: { [page]: { notes, lastDoc, hasMore } } }
  // 上一頁/下一頁在已經看過的頁面之間切換時直接用快取，不用重新查詢 Firestore
  const pageCacheRef = useRef({});

  // toast
  const [toast, setToast] = useState({ show: false, text: "" });
  const toastTimerRef = useRef(null);
  const redirectTimerRef = useRef(null);

  const notesPerPage = 8;
  const myUid = userData?.uid || null;
  const isMyTab = filter === "my";

  // 依 filter tab 建立 Firestore 查詢條件（不含 limit/startAfter）。
  // "my" 分頁需要 uid 相等 + createdAt 排序，"latest"/"hot" 只要一個排序欄位，
  // 三種都是「等式篩選 + 對其他欄位排序」，Firestore 都需要對應的複合索引
  // （見 firestore.indexes.json）
  const buildFilterConstraints = (f) => {
    const constraints = [where("deleted", "==", false)];
    if (f === "my") constraints.push(where("uid", "==", myUid));
    constraints.push(orderBy(SORT_FIELD[f], "desc"));
    return constraints;
  };

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

      let q;
      if (page === 1) {
        q = query(collection(db, "sharedNotes"), ...buildFilterConstraints(f), limit(notesPerPage + 1));
      } else {
        const prevPage = cacheForFilter[page - 1];
        if (!prevPage) return; // 只能逐頁往前推進，上一頁必定已在快取中
        q = query(
          collection(db, "sharedNotes"),
          ...buildFilterConstraints(f),
          startAfter(prevPage.lastDoc),
          limit(notesPerPage + 1)
        );
      }

      const snap = await getDocs(q);
      const rows = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      // 多抓 1 筆只是用來判斷「還有沒有下一頁」，實際顯示仍是 notesPerPage 筆
      const more = rows.length > notesPerPage;
      const pageRows = rows.slice(0, notesPerPage);
      const lastDoc = snap.docs[Math.min(notesPerPage, snap.docs.length) - 1] || null;

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
      const constraints = [where("deleted", "==", false)];
      if (f === "my") constraints.push(where("uid", "==", myUid));
      const countSnap = await getCountFromServer(query(collection(db, "sharedNotes"), ...constraints));
      setTotalCount(countSnap.data().count);
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

  // 關鍵字搜尋只在目前這一頁（已載入的筆記）內比對，不會跨頁搜尋整個資料庫，
  // 見下方搜尋框旁的說明文字
  const filteredNotes = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return pageNotes;
    return pageNotes.filter((n) => {
      const title = (n.title || "").toLowerCase();
      const user = (n.username || "").toLowerCase();
      const preview = (n.preview || "").replace(/<[^>]+>/g, " ").toLowerCase();
      return title.includes(kw) || user.includes(kw) || preview.includes(kw);
    });
  }, [pageNotes, keyword]);

  const totalPages = totalCount != null ? Math.max(1, Math.ceil(totalCount / notesPerPage)) : null;
  const paginatedNotes = filteredNotes;

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

  const openModal = async (note) => {
    try {
      const full = await getDoc(doc(db, "sharedNotes", note.id));
      if (full.exists()) {
        setModalNote({ id: full.id, ...full.data() });
        setShowModal(true);
      }
    } catch (e) {
      console.error("Open modal error:", e);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setModalNote(null);
  };

  const isMine = (note) => userData && note.uid === userData.uid;
  const likedByMe = (note) =>
    userData ? (note.likedBy || []).includes(userData.uid) : false;

  // 顯示 toast（會自動隱藏）
  const showToast = (text, duration = 2500) => {
    setToast({ show: true, text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast({ show: false, text: "" }), duration);
  };

  // 可切換的按讚（含未登入導向）
  const toggleLike = async (e, note, _source = "card") => {
    e.stopPropagation();

    if (!userData) {
      showToast("請先登入後再按讚");
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = setTimeout(() => navigate("/login"), 1000);
      return;
    }
    if (isMine(note)) return;

    const already = likedByMe(note);
    const noteRef = doc(db, "sharedNotes", note.id);
    const newLikedBy = already
      ? (note.likedBy || []).filter((uid) => uid !== userData.uid)
      : [...(note.likedBy || []), userData.uid];
    const newLikes = Math.max(0, (note.likes || 0) + (already ? -1 : 1));

    // 列表
    setPageNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, likes: newLikes, likedBy: newLikedBy } : n))
    );
    updateCurrentPageCache((notes) =>
      notes.map((n) => (n.id === note.id ? { ...n, likes: newLikes, likedBy: newLikedBy } : n))
    );
    // Modal
    setModalNote((prev) =>
      prev && prev.id === note.id ? { ...prev, likes: newLikes, likedBy: newLikedBy } : prev
    );

    try {
      await updateDoc(noteRef, { likes: newLikes, likedBy: newLikedBy });
    } catch (e) {
      console.error("toggleLike error:", e);
      // 回滾
      setPageNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
      updateCurrentPageCache((notes) => notes.map((n) => (n.id === note.id ? note : n)));
      setModalNote((prev) => (prev && prev.id === note.id ? { ...note } : prev));
      showToast("操作失敗，請稍後再試");
    }
  };

  const handleModalDelete = async () => {
    if (!modalNote || !isMyTab || myUid !== modalNote.uid) return;
    if (!window.confirm("確定要刪除這則筆記？")) return;
    try {
      await updateDoc(doc(db, "sharedNotes", modalNote.id), { deleted: true });
      setPageNotes((prev) => prev.filter((n) => n.id !== modalNote.id));
      updateCurrentPageCache((notes) => notes.filter((n) => n.id !== modalNote.id));
      setTotalCount((prev) => (prev != null ? Math.max(0, prev - 1) : prev));
      closeModal();
    } catch (e) {
      console.error("Delete error:", e);
      showToast("刪除失敗，請稍後再試");
    }
  };

  // 從分享連結直接開啟特定筆記：不依賴目前這一頁有沒有載入這筆資料，
  // 直接用 id 去讀，涵蓋筆記在其他頁的情況
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const full = await getDoc(doc(db, "sharedNotes", id));
        if (full.exists()) {
          setModalNote({ id: full.id, ...full.data() });
          setShowModal(true);
        }
      } catch (e) {
        console.error("Open modal from URL error:", e);
      }
    })();
  }, [id]);

  // 清理計時器
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  return (
    <div className="yy-page">
    <div className="note-hero yy-fade-up">
      <span className="yy-eyebrow">◆ NOTES ◆</span>
      <h1 className="note-hero-title">筆記</h1>
      <TabSwitch
        tabs={[{ key: "write", label: "✎ 寫筆記" }, { key: "share", label: "☺ 筆記分享區" }]}
        active="share"
        onChange={(key) => { if (key === "write") navigate("/note"); }}
      />
    </div>
    <div className="ns-wrap">
      {/* Toolbar */}
      <div className="ns-toolbar">
        <div className="ns-search-group">
          <div className="ns-search">
            <span className="ns-search-icon">🔎</span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜尋..."
              className="ns-search-input"
              aria-label="搜尋筆記"
            />
          </div>
          <span className="ns-search-hint">僅搜尋目前頁面已載入的筆記</span>
        </div>

        <div className="ns-tabs">
          {[
            { key: "my", label: "我的" },
            { key: "latest", label: "最新" },
            { key: "hot", label: "熱門" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`ns-tab ${filter === t.key ? "active" : ""}`}
            >
              {t.label}
            </button>
          ))}

          <button
            className="ns-refresh"
            title="重新整理"
            aria-label="重新整理"
            onClick={() => setRefreshTick((x) => x + 1)}
          >
            ⟳
          </button>
        </div>
      </div>

      {/* 未發布筆記狀態 */}
      {isMyTab && !myUid && <div className="ns-empty">請先登入以查看你曾發布的筆記。</div>}
      {!loadingPage && filteredNotes.length === 0 && <div className="ns-empty">目前沒有可顯示的分享筆記。</div>}

      {/* 卡片 */}
      <div className="ns-grid">
        {paginatedNotes.map((note) => {
          const _canInteract = userData && !isMine(note);
          const iLike = likedByMe(note);

          return (
            <div key={note.id} className="ns-card" onClick={() => openModal(note)}>
              <div className="ns-card-head">
                {note.avatarUrl ? (
                  <img src={note.avatarUrl} alt="avatar" className="ns-avatar" loading="lazy" />
                ) : (
                  <div className="ns-avatar ns-avatar-fallback">👤</div>
                )}

                <div className="ns-meta">
                  <div className="ns-username">{note.username || "使用者名稱"}</div>
                  <div className="ns-time">{timeAgo(note.createdAt)}</div>
                </div>

                {isMyTab && myUid === note.uid && <span className="ns-edit">編輯</span>}
              </div>

              <div className="ns-card-body">
                <div className="ns-title">
                  {note.pages && note.pages.length > 0
                    ? note.pages[0].title || "標題"
                    : "標題"}
                </div>
                <div
                  className="ns-preview"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(note.preview || "<p>內容</p>"),
                  }}
                />
                <div className="ns-like-row">
                  <button
                    className={`ns-like-btn ${iLike ? "is-liked" : ""}`}
                    onClick={(e) => toggleLike(e, note, "card")}
                    aria-label={iLike ? "取消按讚" : "按讚"}
                  >
                    <Heart size={20} fill={iLike ? "red" : "none"} /><span>{note.likes || 0}</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 分頁：上一頁/下一頁對應 Firestore 的游標分頁（見 fetchPage），
          hasMore 是這次查詢實際多抓的那 1 筆是否存在，才是「還有沒有下一頁」的準確依據；
          totalPages 只是用 getCountFromServer 抓到的總筆數換算，僅供顯示參考 */}
      {(pageNotes.length > 0 || currentPage > 1) && (
        <div className="ns-pager">
          <div className="ns-pager-btns">
            <button
              className="ns-page-btn"
              disabled={currentPage === 1 || loadingPage}
              onClick={() => goToPage(currentPage - 1)}
            >
              上一頁
            </button>
            <button
              className="ns-page-btn"
              disabled={!hasMore || loadingPage}
              onClick={() => goToPage(currentPage + 1)}
            >
              下一頁
            </button>
          </div>
          <div className="ns-page-info">
            第 <strong className="ns-page-num">{currentPage}</strong> 頁
            {totalPages != null && ` / 共 ${totalPages} 頁`}
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && modalNote && (
        <div className="ns-modal-mask" onClick={closeModal}>
          <div className="ns-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="ns-modal-title">{modalNote.pages[0].title || "筆記內容"}</h2>
            <p className="ns-modal-sub">
              分享者：{modalNote.username || "匿名者"} ❤️ {modalNote.likes || 0}
            </p>

            {userData && !isMine(modalNote) && (
              <div style={{ marginBottom: "0.75rem" }}>
                <button
                  className={`ns-like-btn ${likedByMe(modalNote) ? "is-liked" : ""}`}
                  onClick={(e) => toggleLike(e, modalNote, "modal")}
                >
                  {likedByMe(modalNote) ? "收回讚" : "按讚"}
                </button>
              </div>
            )}

            {(modalNote.pages || []).map((pg, i) => (
              <div key={i} className="ns-modal-page">
                <div className="ns-page-label">第 {i + 1} 頁</div>
                <div
                  className="ns-modal-content"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(pg.content) }}
                />
              </div>
            ))}

            <div className="ns-modal-actions">
              {isMyTab && myUid && modalNote.uid === myUid && (
                <button className="ns-btn danger" onClick={handleModalDelete}>
                  刪除筆記
                </button>
              )}
              <button className="ns-btn" onClick={closeModal}>
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast.show && (
        <div className="ns-toast">
          {toast.text}
        </div>
      )}
    </div>
    </div>
  );
}