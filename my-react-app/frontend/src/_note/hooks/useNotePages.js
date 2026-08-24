import { useCallback, useRef, useState, useEffect } from "react";
import DOMPurify from "dompurify";
import { useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Image as ImageExtension } from "@tiptap/extension-image";
import FontSize from "../fontSizeExtension";

function createEmptyNote(title = "") {
  return { id: crypto.randomUUID(), title, content: "<p></p>" };
}

/**
 * 把 localStorage 讀出來的原始值整理成可用的筆記陣列。輸入可能是任何形狀——
 * 使用者/擴充功能直接改過 localStorage、舊版資料、或單純損毀的內容——這裡只
 * 負責「不管收到什麼，都回傳一份每筆都有唯一 id 的陣列」，不在這裡判斷內容
 * 好不好，那是編輯器層級的事。
 */
function normalizeStoredNotes(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { notes: [createEmptyNote()], changed: true };
  }
  let changed = false;
  const seenIds = new Set();
  const notes = parsed.map((note) => {
    if (!note || typeof note !== "object" || Array.isArray(note)) {
      changed = true;
      return createEmptyNote();
    }
    if (note.id == null || seenIds.has(note.id)) {
      changed = true;
      const id = crypto.randomUUID();
      seenIds.add(id);
      return { ...note, id };
    }
    seenIds.add(note.id);
    return note;
  });
  return { notes, changed };
}

/**
 * 本機（localStorage）多頁筆記狀態，跟負責顯示/編輯內容的 TipTap 編輯器緊密綁在
 * 一起（換頁要把編輯器內容換成該頁筆記、編輯器內容變動要判斷是否為未儲存狀態），
 * 從 _note/index.jsx 抽出來，讓頁面元件只需要處理畫面。
 */
export function useNotePages(uid) {
  const [notes, setNotes] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [storageError, setStorageError] = useState(null);
  // 分享選取記的是筆記 id，不是頁次（FE-11）。原本存的是陣列索引，而
  // handleDelete 會從中間刪掉一頁又完全沒有調整選取內容——選了第 3 頁再刪掉
  // 第 1 頁，選取的索引就會指到另一篇筆記，分享出去的是錯的內容；索引超出
  // 範圍時 notes[i] 是 undefined，_note/index.jsx 接著讀 note.title 會直接
  // 丟 TypeError 讓分享整個中斷。改用 id 之後，刪除／換頁都不會影響選取指向。
  const [selectedPageIds, setSelectedPageIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isDirty, setIsDirty] = useState(false);

  const LOCAL_KEY = `userNotes_${uid}`;

  /**
   * 每個會改動筆記內容的地方都要做同一件事：更新 state、寫回 localStorage。
   * 集中在這裡是因為 localStorage.setItem 可能因為裝置儲存空間不足、無痕模式
   * 封鎖等原因丟例外（不只是讀取時的 JSON.parse 可能壞掉），沒有集中處理的話，
   * 每個呼叫端都要各自補一份 try/catch。
   */
  const persistNotes = useCallback((updatedNotes) => {
    setNotes(updatedNotes);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedNotes));
      setStorageError(null);
    } catch (e) {
      console.error("儲存筆記到本機失敗:", e);
      setStorageError("筆記可能因為裝置儲存空間不足而沒有儲存成功，請清理瀏覽器儲存空間後再試一次。");
    }
    return updatedNotes;
  }, [LOCAL_KEY]);

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
      // 它辨識），載入時補上，避免既有使用者的資料一進來就沒有身分可用；
      // 資料本身也可能損毀（非合法 JSON、不是陣列、內含 null 元素、id 重複）——
      // 這些都不該讓整頁卡在轉圈圈或被外層 ErrorBoundary 接住變成整頁錯誤，
      // 而是退回一份可用的空白筆記。
      try {
        const parsed = JSON.parse(stored);
        const { notes: normalized, changed } = normalizeStoredNotes(parsed);
        if (changed) {
          persistNotes(normalized);
        } else {
          setNotes(normalized);
        }
      } catch (e) {
        console.error("讀取本機筆記失敗，改用一份空白筆記:", e);
        persistNotes([createEmptyNote()]);
      }
    } else {
      persistNotes([createEmptyNote()]);
    }
    setCurrentPage(0);
    setLoading(false);
  }, [LOCAL_KEY, persistNotes]);

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

    return persistNotes(updatedNotes);
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
    const updatedNotes = [...savedNotes, createEmptyNote("未命名筆記")];
    persistNotes(updatedNotes);
    setCurrentPage(updatedNotes.length - 1);
  };

  const handleDelete = () => {
    if (!window.confirm("確定要刪除這則筆記？")) return;
    const deletedId = notes[currentPage]?.id;
    const newNotes = notes.filter((_, i) => i !== currentPage);
    const newPage = Math.max(currentPage - 1, 0);

    const finalNotes = newNotes.length ? newNotes : [createEmptyNote("未命名筆記")];

    persistNotes(finalNotes);
    setCurrentPage(newNotes.length ? newPage : 0);
    // 被刪掉的那一頁如果正在選取中，要一起從分享選取裡移除（FE-11）。
    setSelectedPageIds((prev) => prev.filter((id) => id !== deletedId));
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
    persistNotes(updatedNotes);
  };

  /** limit 存在時最多只勾前 limit 篇（分享頁數上限由呼叫端的頁面元件決定）。 */
  const handleSelectAll = (limit) => {
    const ids = notes.map((note) => note.id);
    setSelectedPageIds(typeof limit === "number" ? ids.slice(0, limit) : ids);
  };
  const handleClearSelect = () => setSelectedPageIds([]);

  return {
    editor, notes, currentPage, selectedPageIds, loading, isDirty, storageError,
    execStyle, handleAdd, handleDelete, handleSave, handleChangePage,
    handleToggleSelect, handleTitleChange, handleSelectAll, handleClearSelect,
  };
}
