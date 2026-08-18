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
  // 分享選取記的是筆記 id，不是頁次（FE-11）。原本存的是陣列索引，而
  // handleDelete 會從中間刪掉一頁又完全沒有調整選取內容——選了第 3 頁再刪掉
  // 第 1 頁，選取的索引就會指到另一篇筆記，分享出去的是錯的內容；索引超出
  // 範圍時 notes[i] 是 undefined，_note/index.jsx 接著讀 note.title 會直接
  // 丟 TypeError 讓分享整個中斷。改用 id 之後，刪除／換頁都不會影響選取指向。
  const [selectedPageIds, setSelectedPageIds] = useState([]);
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
      // 舊版存進 localStorage 的筆記可能沒有 id（換頁同步與分享選取都靠
      // 它辨識），載入時補上，避免既有使用者的資料一進來就沒有身分可用。
      const parsed = JSON.parse(stored);
      let needsMigration = false;
      const migrated = parsed.map((note, index) => {
        if (note?.id != null) return note;
        needsMigration = true;
        return { ...note, id: `legacy-${Date.now()}-${index}` };
      });
      if (needsMigration) {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(migrated));
      }
      setNotes(migrated);
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

  /**
   * 把編輯器目前的內容寫回筆記，並「回傳」寫回之後的完整陣列。
   *
   * 原本這裡是 `const updatedNotes = [...notes]` 之後直接改
   * `updatedNotes[currentPage].content`——淺拷貝的元素跟原陣列是同一個物件，
   * 等於直接改動 React state。它剛好讓「先存檔再馬上讀 notes」拿得到最新
   * 內容，但那是改壞東西之後的副作用，不是這段程式碼真的正確：一旦有人把
   * 淺拷貝改成正確的不可變更新，所有「呼叫完 updateCurrentContent 之後又從
   * 舊的 notes 閉包重新組陣列」的地方，就會安靜地把剛存的內容丟掉。
   *
   * 改成不可變更新，並用回傳值明確傳遞最新結果，讓呼叫端不必依賴
   * setNotes 尚未套用的狀態（呼叫端見 handleAdd／handleSave 與
   * _note/index.jsx 的 handleShare）。
   */
  const updateCurrentContent = () => {
    // 沒有編輯器可讀時沒有東西要寫回，但仍要回傳一個可用的陣列，
    // 呼叫端才能無條件接著使用回傳值。
    if (!editor) return notes;

    const sanitized = DOMPurify.sanitize(editor.getHTML());
    const updatedNotes = notes.map((note, index) => (
      index === currentPage ? { ...note, content: sanitized } : note
    ));

    setNotes(updatedNotes);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedNotes));
    return updatedNotes;
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
    // 一定要從 updateCurrentContent() 的回傳值往下接，不能再用外層的 notes：
    // 那是這次 render 的舊值，會把剛剛寫回的當前頁內容整個蓋掉。
    const savedNotes = updateCurrentContent();
    const newNote = { id: Date.now(), title: "未命名筆記", content: "<p></p>" };
    const updatedNotes = [...savedNotes, newNote];
    setNotes(updatedNotes);
    setCurrentPage(updatedNotes.length - 1);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedNotes));
  };

  const handleDelete = () => {
    if (!window.confirm("確定要刪除這則筆記？")) return;
    const deletedId = notes[currentPage]?.id;
    const newNotes = notes.filter((_, i) => i !== currentPage);
    const newPage = Math.max(currentPage - 1, 0);

    const finalNotes = newNotes.length
      ? newNotes
      : [{ id: Date.now(), title: "未命名筆記", content: "<p></p>" }];

    setNotes(finalNotes);
    setCurrentPage(newNotes.length ? newPage : 0);
    // 被刪掉的那一頁如果正在選取中，要一起從分享選取裡移除（FE-11）。
    setSelectedPageIds((prev) => prev.filter((id) => id !== deletedId));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(finalNotes));
  };

  /** 回傳存檔後的最新陣列，讓呼叫端（例如分享）不必等 setNotes 生效。 */
  const handleSave = () => {
    const savedNotes = updateCurrentContent();
    setIsDirty(false);
    return savedNotes;
  };

  const handleChangePage = (offset) => {
    updateCurrentContent();
    const newPage = Math.min(Math.max(currentPage + offset, 0), notes.length - 1);
    setCurrentPage(newPage);
  };

  const handleToggleSelect = (noteId) => {
    setSelectedPageIds((prev) =>
      prev.includes(noteId) ? prev.filter((id) => id !== noteId) : [...prev, noteId]
    );
  };

  const handleTitleChange = (e) => {
    // 同樣改成不可變更新（見 updateCurrentContent 的說明）。每次按鍵都會產生
    // 新的物件與陣列，這是 React 正常的做法；換頁同步的 effect 依賴的是
    // notes[currentPage]?.id，id 不變，所以改標題不會誤觸重新載入編輯器內容。
    const title = e.target.value;
    const updatedNotes = notes.map((note, index) => (
      index === currentPage ? { ...note, title } : note
    ));
    setNotes(updatedNotes);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedNotes));
  };

  const handleSelectAll = () => setSelectedPageIds(notes.map((note) => note.id));
  const handleClearSelect = () => setSelectedPageIds([]);

  return {
    editor, notes, currentPage, selectedPageIds, loading, isDirty,
    execStyle, handleAdd, handleDelete, handleSave, handleChangePage,
    handleToggleSelect, handleTitleChange, handleSelectAll, handleClearSelect,
  };
}
