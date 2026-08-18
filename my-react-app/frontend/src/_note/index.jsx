import { useState } from "react";
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
  const [selectedImageFile, setSelectedImageFile] = useState(null);

  const {
    editor, notes, currentPage, selectedPages, loading, isDirty,
    execStyle, handleAdd, handleDelete, handleSave, handleChangePage,
    handleToggleSelect, handleTitleChange, handleSelectAll, handleClearSelect,
  } = useNotePages(uid);

  const handleImageFileSelected = (file) => {
    if (file.size > 5 * 1024 * 1024) {
      setError("圖片不得超過 5 MB，請重新選擇。");
      return;
    }
    setSelectedImageFile(file);
    const reader = new FileReader();
    reader.onload = (event) => execStyle("insertImage", event.target.result);
    reader.readAsDataURL(file);
  };

  const handleShare = async () => {
    handleSave();

    const pagesToShare =
      selectedPages.length > 0 ? selectedPages.map((i) => notes[i]) : [];

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

    try {
      let uploadedImageUrl = "";
      if (selectedImageFile) {
        // transform: false 維持原本純 image/upload、不加 f_auto,q_auto 的行為
        uploadedImageUrl = await uploadToCloudinary(selectedImageFile, {
          folder: "tayal_note",
          transform: false,
        });
      }

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
      if (goToShare) {
        navigate("/note/share");
      } else {
        // 繼續留在當前頁面
        setError("");
      }
      setError("");
    } catch (error) {
      console.error("分享失敗：", error);
      setError("分享失敗，請稍後再試。");
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
      <EditorToolbar execStyle={execStyle} onImageFileSelected={handleImageFileSelected} />

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
        </Col>

        {/* 右：分享頁面選擇（移到右側，且 sticky） */}
        <Col md={3} className="sticky-top" style={{ top: 80, height: "calc(100vh - 70px)", zIndex: "100" }}>
          <PageSidebar
            notes={notes}
            currentPage={currentPage}
            isDirty={isDirty}
            selectedPages={selectedPages}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onClearSelect={handleClearSelect}
            onShare={handleShare}
          />
        </Col>
      </Row>

      {/* 底部固定工具列：按鈕改新色系 */}
      <div className="bottom-toolbar mt-3 d-flex align-items-center gap-2 flex-wrap">
        <Button onClick={handleAdd} className="btn-add">新增</Button>
        <Button onClick={handleSave} className="btn-primary">儲存</Button>
        <Button onClick={() => handleChangePage(-1)} className="btn-page" disabled={currentPage === 0}>上一頁</Button>
        <span className="toolbar-page-info">{currentPage + 1} / {notes.length}</span>
        <Button onClick={() => handleChangePage(1)} className="btn-page" disabled={currentPage >= notes.length - 1}>下一頁</Button>
        <Button onClick={handleDelete} className="btn-danger">刪除</Button>
      </div>
    </Container>
    </div>
  );
}

export default NotePage;
