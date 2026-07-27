import { useRef, useState, useEffect } from "react";
import DOMPurify from "dompurify";
import { useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Image as ImageExtension } from "@tiptap/extension-image";
import FontSize from "../fontSizeExtension";

/**
 * 本機（localStorage）多頁筆記狀態，跟負責顯示/編輯內容的 TipTap 編輯器緊密綁在
 * 一起（換頁要把編輯器內容換成該頁筆記、編輯器內容變動要判斷是否為未儲存狀態），
 * 從 _note/index.jsx 抽出來，讓頁面元件只需要處理畫面。
 */
export function useNotePages(uid) {
  const [notes, setNotes] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedPages, setSelectedPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);

  const LOCAL_KEY = `userNotes_${uid}`;

  // onUpdate 是在 useEditor 建立時就固定的閉包，用 ref 保存最新的 notes/currentPage，
  // 避免比對「是否有未儲存的更改」時讀到過期的值。
  const notesRef = useRef(notes);
  const currentPageRef = useRef(currentPage);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);

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
  // 避免 currentPage 沒變但 notes 剛載入完成時漏掉初次同步。只想在「換到不同一篇
  // 筆記」時重新同步，不想在同一篇筆記的內容變動（例如 updateCurrentContent 把
  // 編輯器目前內容寫回 notes）時也跟著重跑，所以透過既有的 notesRef/currentPageRef
  // 讀最新值，不把 notes/currentPage 整包放進依賴陣列。
  const currentNoteId = notes[currentPage]?.id;
  useEffect(() => {
    if (!editor || currentNoteId == null) return;
    editor.commands.setContent(notesRef.current[currentPageRef.current]?.content || "<p></p>", false);
    setIsDirty(false);
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
    setIsDirty(false);
  };

  const handleChangePage = (offset) => {
    updateCurrentContent();
    const newPage = Math.min(Math.max(currentPage + offset, 0), notes.length - 1);
    setCurrentPage(newPage);
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

  return {
    editor, notes, currentPage, selectedPages, loading, isDirty,
    execStyle, handleAdd, handleDelete, handleSave, handleChangePage,
    handleToggleSelect, handleTitleChange, handleSelectAll, handleClearSelect,
  };
}
