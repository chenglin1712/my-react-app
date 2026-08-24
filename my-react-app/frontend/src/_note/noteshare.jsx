import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../src/userServives/authContext";
import { fetchSharedNoteById, softDeleteNote, toggleNoteLike } from "../userServives/noteService";
import { submitReport } from "../userServives/reportService";
import { useSharedNotesPager } from "./hooks/useSharedNotesPager";
import { useToast } from "./hooks/useToast";
import NoteCard from "./components/NoteCard";
import NoteModal from "./components/NoteModal";
import "../../static/css/_note/./notesharestyle.css";
import TabSwitch from "../../components/ui/TabSwitch";

export default function NoteShare() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userData } = useAuth();

  const [filter, setFilter] = useState("latest"); // latest | hot | my
  const [keyword, setKeyword] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [modalNote, setModalNote] = useState(null);

  const myUid = userData?.uid || null;
  const isMyTab = filter === "my";

  const {
    pageNotes, setPageNotes,
    currentPage, hasMore, totalPages, loadingPage, pageError,
    goToPage, refresh, updateCurrentPageCache, decrementTotalCount,
  } = useSharedNotesPager(filter, myUid);
  const { toast, showToast } = useToast();

  const redirectTimerRef = useRef(null);
  // 開 Modal（點卡片、或從 /note/share/:id 這種分享連結進來）可能重疊——
  // 快速點開 A 又點開 B，A 比較慢的回應不該蓋掉 B 已經顯示的內容。
  const modalGenerationRef = useRef(0);
  // 同一則筆記還在等按讚的 Firestore transaction 回來時，先忽略同一則筆記的
  // 下一次點擊，避免用同一份過期資料算兩次（同一分頁內的快速連點）。
  const pendingLikesRef = useRef(new Set());
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

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

  const isMine = (note) => userData && note.uid === userData.uid;
  const likedByMe = (note) =>
    userData ? (note.likedBy || []).includes(userData.uid) : false;

  const openModal = async (note) => {
    const myGeneration = ++modalGenerationRef.current;
    try {
      const full = await fetchSharedNoteById(note.id);
      if (myGeneration !== modalGenerationRef.current) return; // 已經有更新的開啟請求，這次結果不算數
      if (full) {
        setModalNote(full);
        setShowModal(true);
      }
    } catch (e) {
      if (myGeneration !== modalGenerationRef.current) return;
      console.error("Open modal error:", e);
      showToast("開啟筆記失敗，請稍後再試");
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setModalNote(null);
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
    // 上一次按讚還在等 Firestore transaction 回來，先忽略同一則筆記的下一次點擊——
    // 不然兩次點擊會用同一份過期的 note 算出同樣的樂觀結果，等於白按一次。
    if (pendingLikesRef.current.has(note.id)) return;
    pendingLikesRef.current.add(note.id);

    const applyLikeState = (likes, likedBy) => {
      setPageNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, likes, likedBy } : n)));
      updateCurrentPageCache((notes) => notes.map((n) => (n.id === note.id ? { ...n, likes, likedBy } : n)));
      setModalNote((prev) => (prev && prev.id === note.id ? { ...prev, likes, likedBy } : prev));
    };

    const already = likedByMe(note);
    const optimisticLikedBy = already
      ? (note.likedBy || []).filter((uid) => uid !== userData.uid)
      : [...(note.likedBy || []), userData.uid];
    applyLikeState(Math.max(0, optimisticLikedBy.length), optimisticLikedBy);

    try {
      // 用 transaction 讀伺服器上最新的 likedBy 再切換，不是自己算好絕對值整包
      // 覆寫——不同分頁/裝置/使用者同時按讚才不會互相蓋掉對方剛寫入的結果。
      const { likes, likedBy } = await toggleNoteLike(note.id, userData.uid);
      applyLikeState(likes, likedBy);
    } catch (e) {
      console.error("toggleLike error:", e);
      applyLikeState(note.likes || 0, note.likedBy || []); // 回滾成點擊前的狀態
      showToast("操作失敗，請稍後再試");
    } finally {
      pendingLikesRef.current.delete(note.id);
    }
  };

  // 檢舉（含未登入導向，跟 toggleLike 同一套「先讓看得到、點了才擋」的處理）。
  // 失敗時要往上拋（不能吞掉），NoteModal 的檢舉表單靠這個判斷是否該關閉/清空——
  // 不然 Modal 那邊看到 promise 正常 resolve 就會誤以為檢舉成功了。
  const handleReportNote = async (note, reason, reasonText) => {
    if (!userData) {
      showToast("請先登入後再檢舉");
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = setTimeout(() => navigate("/login"), 1000);
      throw new Error("請先登入後再檢舉");
    }
    try {
      await submitReport({ targetType: "note", targetId: note.id, reason, reasonText });
      showToast("已送出檢舉，感謝你協助維護社群品質");
    } catch (e) {
      console.error("Report note error:", e);
      showToast("檢舉送出失敗，請稍後再試");
      throw e;
    }
  };

  const handleModalDelete = async () => {
    if (!modalNote || !isMyTab || myUid !== modalNote.uid) return;
    if (!window.confirm("確定要刪除這則筆記？")) return;
    try {
      await softDeleteNote(modalNote.id);
      // 刪掉的正好是這一頁唯一一筆、而且不是第一頁時，留在原地只會看到空白頁，
      // 應該退回上一頁（見這批審查發現的分頁邊界情況）。
      const wasOnlyNoteOnPage = pageNotes.length === 1 && pageNotes[0]?.id === modalNote.id;
      updateCurrentPageCache((notes) => notes.filter((n) => n.id !== modalNote.id));
      decrementTotalCount();
      closeModal();
      if (wasOnlyNoteOnPage && currentPage > 1) {
        goToPage(currentPage - 1);
      } else {
        setPageNotes((prev) => prev.filter((n) => n.id !== modalNote.id));
      }
    } catch (e) {
      console.error("Delete error:", e);
      showToast("刪除失敗，請稍後再試");
    }
  };

  // 從分享連結直接開啟特定筆記：不依賴目前這一頁有沒有載入這筆資料，
  // 直接用 id 去讀，涵蓋筆記在其他頁的情況
  useEffect(() => {
    if (!id) return;
    const myGeneration = ++modalGenerationRef.current;
    (async () => {
      try {
        const full = await fetchSharedNoteById(id);
        if (myGeneration !== modalGenerationRef.current) return;
        if (full) {
          setModalNote(full);
          setShowModal(true);
        }
      } catch (e) {
        if (myGeneration !== modalGenerationRef.current) return;
        console.error("Open modal from URL error:", e);
      }
    })();
  }, [id]);

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
              type="button"
              onClick={() => setFilter(t.key)}
              className={`ns-tab ${filter === t.key ? "active" : ""}`}
            >
              {t.label}
            </button>
          ))}

          <button
            type="button"
            className="ns-refresh"
            title="重新整理"
            aria-label="重新整理"
            onClick={refresh}
          >
            ⟳
          </button>
        </div>
      </div>

      {/* 未發布筆記狀態 */}
      {isMyTab && !myUid && <div className="ns-empty">請先登入以查看你曾發布的筆記。</div>}
      {pageError && <div className="ns-empty">{pageError}</div>}
      {!pageError && !loadingPage && filteredNotes.length === 0 && <div className="ns-empty">目前沒有可顯示的分享筆記。</div>}

      {/* 卡片 */}
      <div className="ns-grid">
        {filteredNotes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            isMyTab={isMyTab}
            isMine={isMine(note)}
            iLike={likedByMe(note)}
            onOpen={openModal}
            onToggleLike={toggleLike}
          />
        ))}
      </div>

      {/* 分頁：上一頁/下一頁對應 Firestore 的游標分頁（見 useSharedNotesPager），
          hasMore 是這次查詢實際多抓的那 1 筆是否存在，才是「還有沒有下一頁」的準確依據；
          totalPages 只是用 getCountFromServer 抓到的總筆數換算，僅供顯示參考 */}
      {(pageNotes.length > 0 || currentPage > 1) && (
        <div className="ns-pager">
          <div className="ns-pager-btns">
            <button
              type="button"
              className="ns-page-btn"
              disabled={currentPage === 1 || loadingPage}
              onClick={() => goToPage(currentPage - 1)}
            >
              上一頁
            </button>
            <button
              type="button"
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
        <NoteModal
          note={modalNote}
          canLike={Boolean(userData) && !isMine(modalNote)}
          iLike={likedByMe(modalNote)}
          canDelete={isMyTab && Boolean(myUid) && modalNote.uid === myUid}
          onToggleLike={toggleLike}
          onDelete={handleModalDelete}
          onClose={closeModal}
          onReport={handleReportNote}
        />
      )}

      {/* Toast */}
      {toast.show && (
        <div className="ns-toast" role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </div>
    </div>
  );
}
