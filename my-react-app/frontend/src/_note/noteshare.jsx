import { Search } from "lucide-react";
import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../../src/userServives/authContext";
import { fetchSharedNoteById, softDeleteNote, toggleNoteLike } from "../userServives/noteService";
import { NoteCardSkeleton } from "@components/ui/SkeletonShapes";
import EmptyState from "@components/ui/EmptyState";
import { REPORT_ALREADY_OR_DENIED, submitReport } from "../userServives/reportService";
import { useSharedNotesPager } from "./hooks/useSharedNotesPager";
import { useToast } from "./hooks/useToast";
import { usePullToRefresh } from "./hooks/usePullToRefresh";
import { announce } from "@utils/announce";
import NoteCard from "./components/NoteCard";
import NoteModal from "./components/NoteModal";
import SegmentedFilter from "./components/SegmentedFilter";
import "../../static/css/_note/./notesharestyle.css";
import TabSwitch from "../../components/ui/TabSwitch";
import { confirmAction } from "@components/ui/ConfirmDialog";

const LINK_GONE_TITLE = "這則筆記已不存在或已被下架";
const LINK_ERROR_TITLE = "暫時無法開啟這則筆記";

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
  // 手機下拉重新整理（P6-3）。每個手勢都有按鈕備援：工具列上的「重新整理」鈕一直都在。
  const pullToRefresh = usePullToRefresh(refresh, { enabled: !showModal });

  const redirectTimerRef = useRef(null);
  // 開 Modal（點卡片、或從 /note/share/:id 這種分享連結進來）可能重疊——
  // 快速點開 A 又點開 B，A 比較慢的回應不該蓋掉 B 已經顯示的內容。
  const modalGenerationRef = useRef(0);
  // 同一則筆記還在等按讚的 Firestore transaction 回來時，先忽略同一則筆記的
  // 下一次點選，避免用同一份過期資料算兩次（同一分頁內的快速連點）。
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
    // 上一次按讚還在等 Firestore transaction 回來，先忽略同一則筆記的下一次點選——
    // 不然兩次點選會用同一份過期的 note 算出同樣的樂觀結果，等於白按一次。
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
      // 愛心的狀態變化螢幕報讀器看不到，用公告補上（審查項 P2-99）
      // 依伺服器回傳的結果公告：transaction 是以伺服器最新狀態切換，點選前的快照可能已過期
      announce(likedBy?.includes(userData.uid) ? "已按讚" : "已收回讚");
    } catch (e) {
      console.error("toggleLike error:", e);
      applyLikeState(note.likes || 0, note.likedBy || []); // 回滾成點選前的狀態
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
      showToast(
        e?.code === REPORT_ALREADY_OR_DENIED
          ? "你可能已經檢舉過這則筆記，或目前無法送出檢舉"
          : "檢舉送出失敗，請稍後再試",
      );
      throw e;
    }
  };

  const handleModalDelete = async () => {
    if (!modalNote || !isMyTab || myUid !== modalNote.uid) return;
    if (!await confirmAction({
      title: "刪除這則筆記？",
      message: <p className="mb-0">刪除後無法復原。</p>,
      confirmLabel: "刪除筆記",
      cancelLabel: "先不要",
    })) return;
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
  // 直接用 id 去讀，涵蓋筆記在其他頁的情況。
  // 開不起來時要告訴使用者原因，不能只寫 console、讓人停在列表不知道連結怎麼了：
  //   gone  ＝ 這個連結已經失效（筆記不存在，或已被刪除、下架：下架的文件會被 Firestore 規則擋下）
  //   error ＝ 暫時讀不到（斷線、逾時），重試可能就好
  // 連 id 一起記，換到別的連結時舊的提示就不會留著。
  const [linkProblem, setLinkProblem] = useState(null); // { id, kind: "gone" | "error" }
  const [linkRetry, setLinkRetry] = useState(0);
  // 正在重試的連結 id。跟 linkProblem 分開存：重試期間使用者可能點開別張卡片，那會讓重試的結果被
  // 忽略（見下面的世代檢查），如果「重試中」放在 linkProblem 裡，就沒有人把它清掉。
  const [retryingFor, setRetryingFor] = useState(null);
  const linkRunRef = useRef(0);
  const heroTitleRef = useRef(null);
  // 提示關掉後，原本按著的按鈕就不存在了，焦點會掉到頁面最上層；比照換頁（RouteEffects）的作法，
  // 把焦點移到頁面標題，鍵盤與報讀器使用者才知道自己在哪裡。
  const dismissLinkProblem = () => {
    setLinkProblem(null);
    heroTitleRef.current?.focus({ preventScroll: true });
  };
  // 重試期間按鈕維持在原地、改成「重試中…」，並忽略再次點擊。用 aria-disabled 而不是 disabled：
  // disabled 的按鈕會失去焦點，鍵盤使用者按下去之後焦點就消失了。
  const retrying = Boolean(id) && retryingFor === id;
  const retryLink = () => {
    if (retrying) return;
    setRetryingFor(id);
    setLinkRetry((n) => n + 1);
  };
  useEffect(() => {
    if (!id) return undefined;
    const myGeneration = ++modalGenerationRef.current;
    const myRun = ++linkRunRef.current;
    // 世代計數只在「下一次 effect 執行」時才會前進；離開頁面或換連結的瞬間，
    // 舊請求若剛好這時回來，還是會認為自己是最新的，所以另外用 active 旗標在清理時關掉
    let active = true;
    const isCurrent = () => active && myGeneration === modalGenerationRef.current;
    (async () => {
      try {
        const full = await fetchSharedNoteById(id);
        if (!isCurrent()) return;
        if (full) {
          setLinkProblem(null);
          setModalNote(full);
          setShowModal(true);
        } else {
          setLinkProblem({ id, kind: "gone" });
          announce(LINK_GONE_TITLE);
        }
      } catch (e) {
        if (!isCurrent()) return;
        console.error("Open modal from URL error:", e);
        const gone = e?.code === "permission-denied";
        setLinkProblem({ id, kind: gone ? "gone" : "error" });
        announce(gone ? LINK_GONE_TITLE : LINK_ERROR_TITLE);
      } finally {
        // 最後一次請求結束就清掉「重試中」，不論結果有沒有被採用（可能已被別張卡片的點擊取代）
        if (myRun === linkRunRef.current) setRetryingFor(null);
      }
    })();
    return () => { active = false; };
  }, [id, linkRetry]);
  const showLinkProblem = Boolean(id) && linkProblem?.id === id;

  return (
    <div className="yy-page ns-page">
    {/* 下拉指示（P6-3）：純視覺，所以 aria-hidden——這個手勢的無障礙路徑是工具列上一直都在的「重新整理」按鈕。
        拉到門檻前顯示「下拉重新整理」，到了顯示「放開即可重新整理」；位置用 transform，減少動態時不位移。 */}
    <div
      className={`ns-pull${pullToRefresh.state === "idle" ? "" : " is-active"}${pullToRefresh.state === "ready" ? " is-ready" : ""}`}
      style={{ "--ns-pull": `${pullToRefresh.pull}px` }}
      aria-hidden="true"
    >
      {pullToRefresh.state === "ready" ? "放開即可重新整理" : pullToRefresh.state === "pulling" ? "下拉重新整理" : ""}
    </div>
    <div className="note-hero yy-fade-up">
      <h1 className="note-hero-title" ref={heroTitleRef} tabIndex={-1}>筆記分享區</h1>
      <TabSwitch
        tabs={[{ key: "write", label: "✎ 寫筆記" }, { key: "share", label: "☺ 筆記分享區" }]}
        active="share"
        ariaLabel="筆記功能"
        idPrefix="note-tab"
        onChange={(key) => { if (key === "write") navigate("/note"); }}
      />
    </div>
    <div className="ns-wrap">
      {/* 從分享連結進來卻開不起來：說明原因與下一步。列表就在下面，所以「失效」只需要一個關掉提示的按鈕 */}
      {showLinkProblem && linkProblem.kind === "gone" && (
        <EmptyState
          title={LINK_GONE_TITLE}
          actions={<button type="button" className="yy-btn-outline" onClick={dismissLinkProblem}>看看其他筆記</button>}
        >
          <p>這個分享連結可能已失效，或作者已經刪除這則筆記。下方還有其他人分享的筆記，可以直接瀏覽。</p>
        </EmptyState>
      )}
      {showLinkProblem && linkProblem.kind === "error" && (
        <EmptyState
          title={LINK_ERROR_TITLE}
          actions={(
            <button type="button" className="yy-btn-outline" aria-disabled={retrying || undefined} onClick={retryLink}>
              {retrying ? "重試中…" : "再試一次"}
            </button>
          )}
        >
          <p>請檢查網路連線，然後再試一次。</p>
        </EmptyState>
      )}

      {/* Toolbar */}
      <div className="ns-toolbar">
        <div className="ns-search-group">
          <div className="ns-search">
            <span className="ns-search-icon"><Search size={16} aria-hidden="true" /></span>
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
          <SegmentedFilter
            ariaLabel="筆記排序與範圍"
            value={filter}
            onChange={setFilter}
            options={[
              { key: "my", label: "我的" },
              { key: "latest", label: "最新" },
              { key: "hot", label: "熱門" },
            ]}
          />

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
      {isMyTab && !myUid && (
        <EmptyState title="請先登入以查看你曾發布的筆記">
          <p>登入後，你在「寫筆記」分享出去的筆記會列在這裡。</p>
        </EmptyState>
      )}
      {pageError && <div className="ns-empty">{pageError}</div>}
      {!pageError && !loadingPage && pageNotes.length === 0 && !(isMyTab && !myUid) && (
        <EmptyState title={isMyTab ? "你還沒有分享過筆記" : "目前沒有可顯示的分享筆記"}
          actions={<Link to="/note" className="yy-btn-outline">前往寫筆記</Link>}>
          <p>{isMyTab ? "在「寫筆記」寫好一篇後按分享，就會出現在這裡。" : "到「寫筆記」寫好一篇後按分享，第一篇就會出現在這裡。"}</p>
        </EmptyState>
      )}
      {!pageError && !loadingPage && pageNotes.length > 0 && filteredNotes.length === 0 && (
        <EmptyState title="沒有符合的筆記">
          <p>目前頁面已載入的筆記裡找不到這個關鍵字，換個關鍵字，或清除搜尋框再看看。</p>
        </EmptyState>
      )}

      {/* 卡片：第一次載入（還沒有任何筆記）時用貼合版面的骨架，不留空白 */}
      {loadingPage && filteredNotes.length === 0 && !pageError && <NoteCardSkeleton />}
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
        <nav className="ns-pager" aria-label="筆記分頁">
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
          <div className="ns-page-info" aria-live="polite">
            第 <strong className="ns-page-num">{currentPage}</strong> 頁
            {totalPages != null && ` / 共 ${totalPages} 頁`}
          </div>
        </nav>
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
      {/* 常駐的 live region（內容變動才會被可靠地唸出來），顯示與否由 is-visible 的 transition 決定 */}
      <div className={`ns-toast${toast.show ? " is-visible" : ""}`} role="status" aria-live="polite">
        {toast.text}
      </div>
    </div>
    </div>
  );
}
