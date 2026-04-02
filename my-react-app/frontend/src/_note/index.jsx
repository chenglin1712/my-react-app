import { useState, useRef, useEffect } from "react";
import { Container, Button, Row, Col, Spinner, Form, Alert } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../firebase";
import { useAuth } from "../../src/userServives/authContext";
import "../../static/css/_note/notestyle.css";
import "../../static/css/_note/toolbar.css";
import "../../static/css/_note/buttons.css";
import { Image } from "lucide-react";
import DOMPurify from "dompurify";

function NotePage() {
  const navigate = useNavigate();
  const contentRef = useRef(null);
  const { userData } = useAuth();

  const uid = userData?.uid || "guest";
  const [notes, setNotes] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [isEditing, setIsEditing] = useState(true);
  const [selectedPages, setSelectedPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const LOCAL_KEY = `userNotes_${uid}`;

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

  const updateCurrentContent = () => {
    if (!contentRef.current) return;
    const updatedNotes = [...notes];
    updatedNotes[currentPage].content = contentRef.current.innerHTML;
    setNotes(updatedNotes);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedNotes));
  };

  const [isDirty, setIsDirty] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState(null);
  const execStyle = (command, value = null) => {
    if (command === "insertImage" && value) {
      // 插入img
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;

      const range = sel.getRangeAt(0);
      const img = document.createElement("img");
      img.src = value;
      img.style.maxWidth = "30%";
      img.style.height = "auto";
      range.insertNode(img);

      range.setStartAfter(img);
      range.setEndAfter(img);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      document.execCommand(command, false, value);
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

  //有尚未儲存的更改
  const handleContentChange = () => {
    if (!contentRef.current) return;
    const currentHTML = contentRef.current.innerHTML;
    const originalHTML = notes[currentPage]?.content || "<p></p>";

    setIsDirty(currentHTML !== originalHTML);
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
        const data = await res.json();
        uploadedImageUrl = data.secure_url;
      }

      const docRef = await addDoc(collection(db, "sharedNotes"), {
        pages: pagesToShare,
        preview: pagesToShare[0]?.content || "<p></p>",
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
          <span className="group-label">大小</span>
          <select onChange={(e) => execStyle("fontSize", e.target.value)}>
            <option value="3">小</option>
            <option value="4">中</option>
            <option value="5">大</option>
          </select>
        </Col>
        <Col xs="auto" className="group">
          <Button className="btn-ghost" onClick={() => execStyle("bold")}>𝐁</Button>
          <Button className="btn-ghost" onClick={() => execStyle("italic")}>𝑰</Button>
        </Col>
        <Col xs="auto" className="group">
          <input
            type="file"
            accept="image/*"
            id="image-upload"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) {
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
            <Image size={20} />上傳圖片
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
          />

          {/* 編輯器：只保留 .note-text，不再包一層卡片 */}
          <div
            ref={contentRef}
            className="note-text"
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(currentNote.content) }}
            onInput={handleContentChange}
          />

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
