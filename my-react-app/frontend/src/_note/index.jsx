import { useState, useRef, useEffect } from "react";
import { Container, Button, Row, Col, Spinner, Form, Alert } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../src/userServives/authContext";
import "../../static/css/_note/notestyle.css";
import "../../static/css/_note/toolbar.css";
import "../../static/css/_note/buttons.css";
import { Image as ImageIcon } from "lucide-react";
import DOMPurify from "dompurify";
import { useEditor, EditorContent } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Image as ImageExtension } from "@tiptap/extension-image";
import FontSize from "./fontSizeExtension";

function NotePage() {
  const navigate = useNavigate();
  const { userData } = useAuth();

  const uid = userData?.uid || "guest";
  const [notes, setNotes] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [_isEditing, setIsEditing] = useState(true);
  const [selectedPages, setSelectedPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const LOCAL_KEY = `userNotes_${uid}`;

  // onUpdate 是在 useEditor 建立時就固定的閉包，用 ref 保存最新的 notes/currentPage，
  // 避免比對「是否有未儲存的更改」時讀到過期的值。
  const notesRef = useRef(notes);
  const currentPageRef = useRef(currentPage);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

  const [isDirty, setIsDirty] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontSize,
      ImageExtension.configure({
        HTMLAttributes: { style: "max-width: 30%; height: auto;" },
      }),
    ],
    content: "<p></p>",
    onUpdate: ({ editor }) => {
      const currentHTML = editor.getHTML();
      const originalHTML = notesRef.current[currentPageRef.current]?.content || "<p></p>";
      setIsDirty(currentHTML !== originalHTML);
    },
  });

  useEffect(() => {
    const stored = localStorage.getItem(LOCAL_KEY);
    if (stored) {
      setNotes(JSON.parse(stored));
    } else {
      const defaultNote = [
        { id: Date.now(), title: "", content: "" },
      ];
      localStorage.setItem(LOCAL_KEY, JSON.stringify(defaultNote));
      setNotes(defaultNote);
    }
    setCurrentPage(0);
    setLoading(false);
  }, [LOCAL_KEY]);

  // 換頁時把編輯器內容換成該頁筆記，用筆記 id 當依據，
  // 避免 currentPage 沒變但 notes 剛載入完成時漏掉初次同步。
  const currentNoteId = notes[currentPage]?.id;
  useEffect(() => {
    if (!editor || currentNoteId == null) return;
    editor.commands.setContent(notes[currentPage]?.content || "<p></p>", false);
    setIsDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNoteId, editor]);

  const updateCurrentContent = () => {
    if (!editor) return;
    const updatedNotes = [...notes];
    updatedNotes[currentPage].content = DOMPurify.sanitize(editor.getHTML());
    setNotes(updatedNotes);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedNotes));
  };

  const execStyle = (command, value = null) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (command) {
      case "bold":
        chain.toggleBold().run();
        break;
      case "italic":
        chain.toggleItalic().run();
        break;
      case "fontSize":
        chain.setFontSize(value).run();
        break;
      case "foreColor":
        chain.setColor(value).run();
        break;
      case "insertImage":
        if (value) chain.setImage({ src: value }).run();
        break;
      default:
        break;
    }
  };

  const handleAdd = () => {
    updateCurrentContent();
    const newNote = { id: Date.now(), title: "未命名筆記", content: "<p></p>" };
    const updatedNotes = [...notes, newNote];
    setNotes(updatedNotes);
    setCurrentPage(updatedNotes.length - 1);
    setIsEditing(true);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedNotes));
  };

  const handleDelete = () => {
    if (!window.confirm("確定要刪除這則筆記？")) return;
    const newNotes = notes.filter((_, i) => i !== currentPage);
    const newPage = Math.max(currentPage - 1, 0);

    const finalNotes = newNotes.length
      ? newNotes
      : [{ id: Date.now(), title: "未命名筆記", content: "<p></p>" }];

    setNotes(finalNotes);
    setCurrentPage(newNotes.length ? newPage : 0);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(finalNotes));
  };

  const handleSave = () => {
    updateCurrentContent();
    setIsEditing(false);
    setIsDirty(false);
  };

  const handleChangePage = (offset) => {
    updateCurrentContent();
    const newPage = Math.min(Math.max(currentPage + offset, 0), notes.length - 1);
    setCurrentPage(newPage);
    setIsEditing(false);
  };

  const handleToggleSelect = (index) => {
    setSelectedPages((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  const handleTitleChange = (e) => {
    const updatedNotes = [...notes];
    updatedNotes[currentPage].title = e.target.value;
    setNotes(updatedNotes);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedNotes));
  };

  const handleSelectAll = () => setSelectedPages(notes.map((_, index) => index));
  const handleClearSelect = () => setSelectedPages([]);

  const handleShare = async () => {
    handleSave();

    const pagesToShare =
      selectedPages.length > 0 ? selectedPages.map((i) => notes[i]) : [];

    const hasEmptyTitle = pagesToShare.some((note) => !note.title?.trim());

    if (pagesToShare.length === 0) {
      setError("請至少選擇一頁要分享的筆記。");
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
        const formData = new FormData();
        formData.append("file", selectedImageFile);
        formData.append("upload_preset", import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET);
        formData.append("folder", "tayal_note");

        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME}/image/upload`,
          { method: "POST", body: formData }
        );
        if (!res.ok) throw new Error(`圖片上傳失敗 (HTTP ${res.status})`);
        const data = await res.json();
        uploadedImageUrl = data.secure_url;
      }

      const sanitizedPages = pagesToShare.map(p => ({
        ...p,
        content: DOMPurify.sanitize(p.content || ""),
      }));

      await addDoc(collection(db, "sharedNotes"), {
        pages: sanitizedPages,
        preview: DOMPurify.sanitize(pagesToShare[0]?.content || "<p></p>"),
        image: uploadedImageUrl || "",
        createdAt: serverTimestamp(),
        likes: 0,
        likedBy: [],
        uid: uid,
        username: effectiveName,
        avatarUrl: effectiveImg,
        deleted: false,
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
      alert("分享失敗，請稍後再試。");
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
    <Container fluid className="main-container">
      {/* 上方編輯工具列 */}
      <Row className="editor-toolbar">
        <Col xs="auto" className="group">
          <label htmlFor="note-font-size-select" className="group-label">大小</label>
          <select id="note-font-size-select" onChange={(e) => execStyle("fontSize", e.target.value)} defaultValue="24px">
            <option value="16px">小</option>
            <option value="24px">中</option>
            <option value="32px">大</option>
          </select>
        </Col>
        <Col xs="auto" className="group">
          <Button className="btn-ghost" onClick={() => execStyle("bold")} aria-label="粗體">𝐁</Button>
          <Button className="btn-ghost" onClick={() => execStyle("italic")} aria-label="斜體">𝑰</Button>
        </Col>
        <Col xs="auto" className="group">
          <input
            type="file"
            accept="image/*"
            id="image-upload"
            style={{ display: "none" }}
            aria-label="上傳圖片"
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) {
                if (file.size > 5 * 1024 * 1024) {
                  setError("圖片不得超過 5 MB，請重新選擇。");
                  return;
                }
                setSelectedImageFile(file);
                const reader = new FileReader();
                reader.onload = (event) => execStyle("insertImage", event.target.result);
                reader.readAsDataURL(file);
              }
            }}
          />
          <Button
            className="btn-upload"
            onClick={() => document.getElementById("image-upload").click()}
          >
            <ImageIcon size={20} />上傳圖片
          </Button>
        </Col>
        <Col xs="auto" className="group">
          {["red", "blue", "black", "orange"].map((color) => (
            <button
              key={color}
              type="button"
              className="color-box"
              style={{ backgroundColor: color, width: 40, height: 6, border: "none", borderRadius: "6px" }}
              onClick={() => execStyle("foreColor", color)}
              aria-label={`文字顏色：${{ red: "紅色", blue: "藍色", black: "黑色", orange: "橘色" }[color]}`}
            />
          ))}
        </Col>
      </Row>

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

          {/* 編輯區：只保留 .note-text，不再包一層卡片 */}
          <EditorContent editor={editor} className="note-text" />

          {error && <Alert variant="danger" className="mt-3">{error}</Alert>}
        </Col>

        {/* 右：分享頁面選擇（移到右側，且 sticky） */}
        <Col md={3} className="sticky-top" style={{ top: 80, height: "calc(100vh - 70px)", zIndex: "100" }}>
          <h5 className="mt-2">分享頁面選擇</h5>
          <div className="mb-2 d-flex gap-2">
            <Button size="sm" className="btn-ghost" onClick={handleSelectAll}>全選</Button>
            <Button size="sm" className="btn-ghost" onClick={handleClearSelect}>取消</Button>
          </div>
          <Form>
            {notes.map((note, index) => (
              <Form.Check
                key={index}
                id={`note-page-select-${index}`}
                type="checkbox"
                label={`第 ${index + 1} 頁：${note.title || "（未命名）"}${index === currentPage && isDirty ? "*" : ""}`}
                checked={selectedPages.includes(index)}
                onChange={() => handleToggleSelect(index)}
                className="mb-1"
              />
            ))}
          </Form>

          {selectedPages.length > 0 && (
            <Button
              className="btn-primary mt-2 w-100"
              onClick={handleShare}
            >
              分享
            </Button>
          )}
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
  );
}

export default NotePage;
