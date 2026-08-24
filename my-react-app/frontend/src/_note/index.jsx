import { useRef, useState } from "react";
import { Container, Button, Row, Col, Spinner, Form, Alert } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../src/userServives/authContext";
import { shareNote } from "../userServives/noteService";
import "../../static/css/_note/notestyle.css";
import "../../static/css/_note/toolbar.css";
import "../../static/css/_note/buttons.css";
import DOMPurify from "dompurify";
import ErrorBoundary from "../errorBoundary";
import TabSwitch from "../../components/ui/TabSwitch";
import { EditorContent } from "@tiptap/react";
import { useNotePages } from "./hooks/useNotePages";
import EditorToolbar from "./components/EditorToolbar";
import PageSidebar from "./components/PageSidebar";
import { buildPreview, SHARE_MAX_PAGES } from "../../utils/notePreview";
import { uploadToCloudinary } from "@utils/uploadToCloudinary";

function NotePage() {
  const navigate = useNavigate();
  const { userData } = useAuth();
  const uid = userData?.uid || "guest";

  const [error, setError] = useState("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  // 目前編輯器裡最後一次成功上傳的圖片網址，分享時當作封面圖存進 sharedNotes
  // 的 image 欄位（給 SharedNotesModeration 審核頁顯示縮圖用，見 noteService.jsx）。
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const sharingLockRef = useRef(false);

  const {
    editor, notes, currentPage, selectedPageIds, loading, isDirty, storageError,
    execStyle, handleAdd, handleDelete, handleSave, handleChangePage,
    handleToggleSelect, handleTitleChange, handleSelectAll, handleClearSelect,
  } = useNotePages(uid);

  /**
   * 圖片原本是選取後用 FileReader 轉成 Base64 直接塞進編輯器內容，這段內容
   * 之後會原封不動存進 localStorage、分享時又整包寫進 Firestore 的 pages 欄位。
   * 一張圖轉出來的 Base64 很容易讓 pages 內容超過 Firestore 單一文件 1 MiB
   * 的上限（buildPreview() 的註解也記錄了同一個問題曾經讓「只要分享的筆記
   * 裡有圖片就一定失敗」）。改成選取後立刻上傳 Cloudinary、editor 只插入
   * 真正的圖片網址，內容本身永遠是一段很短的 <img src="https://...">。
   */
  const handleImageFileSelected = async (file) => {
    if (file.size > 5 * 1024 * 1024) {
      setError("圖片不得超過 5 MB，請重新選擇。");
      return;
    }
    setIsUploadingImage(true);
    setError("");
    try {
      // transform: false 維持原本純 image/upload、不加 f_auto,q_auto 的行為
      const url = await uploadToCloudinary(file, { folder: "tayal_note", transform: false });
      setUploadedImageUrl(url);
      execStyle("insertImage", url);
    } catch (err) {
      console.error("圖片上傳失敗：", err);
      setError("圖片上傳失敗，請稍後再試。");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleShare = async () => {
    // 快速連點「分享」可能在第一次的 Firestore 寫入還沒回來時就送出第二次，
    // 造成同一份內容被分享兩次；用 ref（不是 state）擋，避免同一個 tick 內
    // 兩次點擊都讀到「還沒在分享中」的舊值。
    if (sharingLockRef.current) return;
    sharingLockRef.current = true;
    setIsSharing(true);

    try {
      // 用 handleSave() 的回傳值，不要用外層的 notes：setNotes 是非同步的，
      // 這一輪 render 的 notes 還看不到剛存進去的當前頁內容（見
      // useNotePages 的 updateCurrentContent 說明）。
      const latestNotes = handleSave();

      // 依「選取的順序」把 id 換回筆記本身（FE-11）——順序沿用使用者勾選的
      // 先後，維持 pagesToShare[0] 就是預覽圖來源的既有行為。filter(Boolean)
      // 是額外的防線：handleDelete 已經會把刪掉的頁次移出選取，但 localStorage
      // 被外部改動之類的情況不該讓分享直接丟例外。
      const notesById = new Map(latestNotes.map((note) => [note.id, note]));
      const pagesToShare = selectedPageIds
        .map((id) => notesById.get(id))
        .filter(Boolean);

      const hasEmptyTitle = pagesToShare.some((note) => !note.title?.trim());

      if (pagesToShare.length === 0) {
        setError("請至少選擇一頁要分享的筆記。");
        return;
      }
      if (pagesToShare.length > SHARE_MAX_PAGES) {
        setError(`最多只能分享 ${SHARE_MAX_PAGES} 頁筆記，目前選取了 ${pagesToShare.length} 頁，請減少選取頁數。`);
        return;
      }
      if (hasEmptyTitle) {
        setError("所選頁面中包含空白標題，請填寫後再分享。");
        return;
      }

      const effectiveName = userData?.firestoreData?.name || "匿名";
      const effectiveImg = userData?.firestoreData?.avatarUrl || null;

      const sanitizedPages = pagesToShare.map(p => ({
        ...p,
        content: DOMPurify.sanitize(p.content || ""),
      }));

      await shareNote({
        pages: sanitizedPages,
        preview: buildPreview(pagesToShare[0]?.content),
        image: uploadedImageUrl,
        uid,
        username: effectiveName,
        avatarUrl: effectiveImg,
      });

      const goToShare = window.confirm(
        "上傳成功！\n\n要立即前往分享頁面嗎？\n\n按「確定」前往，按「取消」繼續留在此頁。"
      );
      setError("");
      if (goToShare) {
        navigate("/note/share");
      }
    } catch (err) {
      console.error("分享失敗：", err);
      setError("分享失敗，請稍後再試。");
    } finally {
      sharingLockRef.current = false;
      setIsSharing(false);
    }
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: "70vh" }}>
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  const currentNote = notes[currentPage] || { title: "", content: "<p></p>" };

  return (
    <div className="yy-page">
    <div className="note-hero yy-fade-up">
      <span className="yy-eyebrow">◆ NOTES ◆</span>
      <h1 className="note-hero-title">筆記</h1>
      <TabSwitch
        tabs={[{ key: "write", label: "✎ 寫筆記" }, { key: "share", label: "☺ 筆記分享區" }]}
        active="write"
        onChange={(key) => { if (key === "share") navigate("/note/share"); }}
      />
    </div>
    <Container fluid className="main-container">
      <EditorToolbar execStyle={execStyle} onImageFileSelected={handleImageFileSelected} isUploadingImage={isUploadingImage} />

      <Row>
        {/* 左：編輯區 */}
        <Col md={9}>
          {/* 標題：紅色圓角邊框 */}
          <Form.Control
            className="note-title mb-3"
            type="text"
            value={currentNote.title}
            onChange={handleTitleChange}
            placeholder="請輸入筆記標題"
            aria-label="筆記標題"
          />

          {/* 編輯區：只保留 .note-text，不再包一層卡片。
              包一層 ErrorBoundary，避免 TipTap 出錯時把整個筆記頁清空。 */}
          <ErrorBoundary fallback={<Alert variant="warning" className="mt-2">編輯器發生錯誤，請重新整理頁面再試一次。</Alert>}>
            <EditorContent editor={editor} className="note-text" />
          </ErrorBoundary>

          {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
          {storageError && <Alert variant="warning" className="mt-3">{storageError}</Alert>}
        </Col>

        {/* 右：分享頁面選擇（移到右側，且 sticky） */}
        <Col md={3} className="sticky-top" style={{ top: 80, height: "calc(100vh - 70px)", zIndex: "100" }}>
          <PageSidebar
            notes={notes}
            currentPage={currentPage}
            isDirty={isDirty}
            selectedPageIds={selectedPageIds}
            maxSelectable={SHARE_MAX_PAGES}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onClearSelect={handleClearSelect}
            onShare={handleShare}
            isSharing={isSharing}
          />
        </Col>
      </Row>

      {/* 底部固定工具列：按鈕改新色系 */}
      <div className="bottom-toolbar mt-3 d-flex align-items-center gap-2 flex-wrap">
        <Button type="button" onClick={handleAdd} className="btn-add">新增</Button>
        <Button type="button" onClick={handleSave} className="btn-primary">儲存</Button>
        <Button type="button" onClick={() => handleChangePage(-1)} className="btn-page" disabled={currentPage === 0}>上一頁</Button>
        <span className="toolbar-page-info">{currentPage + 1} / {notes.length}</span>
        <Button type="button" onClick={() => handleChangePage(1)} className="btn-page" disabled={currentPage >= notes.length - 1}>下一頁</Button>
        <Button type="button" onClick={handleDelete} className="btn-danger">刪除</Button>
      </div>
    </Container>
    </div>
  );
}

export default NotePage;
