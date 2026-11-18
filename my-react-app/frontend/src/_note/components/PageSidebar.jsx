import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Offcanvas } from "react-bootstrap";
import { previewText } from "../pagePreview";

// 一頁一張卡。memo：打字時只有「目前這一頁」的 note 物件會換，其他 199 張卡的 props 都沒變，不會重繪，
// 預覽文字也只在內容真的變了才重算（原本每打一個字就把全部筆記的預覽重算一遍）。
const PageCard = memo(function PageCard({ note, index, isCurrent, dirty, checked, unsynced, onSelect, onToggle }) {
  const preview = useMemo(() => previewText(note.content), [note.content]);
  const name = `第 ${index + 1} 頁：${note.title || "（未命名）"}${isCurrent && dirty ? "*" : ""}${unsynced ? "（未同步）" : ""}`;
  return (
    // 每一頁是一張卡片：左邊的方框是「選取來分享」，右邊整塊是「切換到這一頁」（兩件事分開，點頁面不會誤勾分享）。
    // 已勾選的卡片多一圈強調框，目前編輯的那頁有「目前編輯」標籤，都不只靠顏色。
    <li id={`note-page-card-${note.id}`} className={`note-page-card${checked ? " is-selected" : ""}${isCurrent ? " is-current" : ""}`}>
      <input
        id={`note-page-select-${note.id}`}
        type="checkbox"
        className="note-page-check"
        checked={checked}
        onChange={() => onToggle(note.id)}
        aria-label={`分享：${name}`}
      />
      <button
        type="button"
        className="note-page-main"
        aria-current={isCurrent ? "page" : undefined}
        aria-describedby={preview ? `note-page-preview-${note.id}` : undefined}
        onClick={() => onSelect(index)}
      >
        <span className="note-page-title">{name}</span>
        {isCurrent && <span className="note-page-badge">目前編輯</span>}
        {preview && <span id={`note-page-preview-${note.id}`} className="note-page-preview">{preview}</span>}
      </button>
    </li>
  );
});

/**
 * 左側「頁面」縮圖列（P5-3）：像 Apple 備忘錄——每頁一張卡片（標題＋內容預覽），點卡片切換頁面，
 * 卡片左邊的方框勾選要分享的頁面，底下是全選／取消／分享。
 * 電腦版是固定在左邊的欄位；手機（< md）收成抽屜，用「頁面」按鈕打開（焦點由 Offcanvas 管理：開啟時移進抽屜、關閉時回到按鈕）。
 */
export default function PageSidebar({
  notes, currentPage, isDirty, selectedPageIds, maxSelectable,
  onToggleSelect, onSelectAll, onClearSelect, onShare, isSharing, unsyncedIds, onSelectPage,
}) {
  const [open, setOpen] = useState(false);
  const overLimit = maxSelectable != null && notes.length > maxSelectable;
  const noneSelected = selectedPageIds.length === 0;

  // 卡片是 memo 的，傳進去的函式必須穩定；最新的 props 放在 ref 裡讀，函式本身不會每次重繪都換新
  const latest = useRef({});
  // useLayoutEffect：在畫面提交的同一個時間點就更新，使用者不可能在「新畫面已出現、callback 還是舊的」之間點到
  useLayoutEffect(() => { latest.current = { onToggleSelect, onSelectPage }; });
  const handleToggle = useCallback((id) => latest.current.onToggleSelect?.(id), []);
  const handleSelect = useCallback((index) => {
    latest.current.onSelectPage?.(index);
    setOpen(false); // 手機：選了頁面就收起抽屜（電腦版沒有抽屜，這行無作用）
  }, []);

  // 響應式 Offcanvas 的 show 在電腦版（內容直接顯示）不會自己清掉：先在手機開著抽屜、把視窗拉寬、再縮回來，
  // 抽屜會憑空重新打開並抓走焦點。拉寬到 md 以上時主動關掉。
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(min-width: 768px)");   // Bootstrap 的 md，跟 Offcanvas responsive="md" 同一條線
    const onChange = () => { if (mq.matches) setOpen(false); };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // 目前這張卡要捲進清單的可見範圍：用上一頁／下一頁換頁時、以及手機抽屜打開時（關著的時候清單是隱藏的，捲不動）
  const currentId = notes[currentPage]?.id;
  useEffect(() => {
    if (!currentId) return;
    document.getElementById(`note-page-card-${currentId}`)?.scrollIntoView?.({ block: "nearest" });
  }, [currentId, open]);

  const selectedSet = new Set(selectedPageIds);
  const unsyncedSet = unsyncedIds ? new Set(unsyncedIds) : null;

  return (
    <>
      <Button type="button" className="btn-outline note-rail-toggle d-md-none w-100" onClick={() => setOpen(true)} aria-haspopup="dialog">
        頁面（第 {currentPage + 1} / {notes.length} 頁）
      </Button>
      {/* 手機的抽屜預設會被移到 <body> 底下，脫離 .note-page，筆記頁的按鈕與卡片樣式（都限縮在 .note-page 底下）就套不到；
          container 讓抽屜留在 .note-page 裡面（沒有 .note-page 時，例如單獨測試這個元件，退回 body） */}
      <Offcanvas
        responsive="md"
        placement="start"
        show={open}
        onHide={() => setOpen(false)}
        container={() => document.querySelector(".note-page")}
        className="note-rail"
        aria-labelledby="note-rail-title"
      >
        <Offcanvas.Header closeButton closeLabel="關閉頁面清單">
          <Offcanvas.Title id="note-rail-title">頁面</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="note-rail-body">
          {/* 響應式 Offcanvas 在電腦版會把 body 設成 display: flex（子元素變成橫排），所以內容要包成單一個容器 */}
          <div className="note-rail-inner">
          <h5 className="d-none d-md-block mt-2">頁面</h5>
          {maxSelectable != null && (
            <div className="ns-select-hint mb-1">
              勾選方框可選取要分享的頁面：已選 {selectedPageIds.length} / 上限 {maxSelectable} 頁
              {overLimit && `（共 ${notes.length} 頁，全選只會勾選前 ${maxSelectable} 頁）`}
            </div>
          )}
          <div className="mb-2 d-flex gap-2">
            <Button type="button" size="sm" className="btn-ghost" onClick={() => onSelectAll(maxSelectable)}>全選</Button>
            <Button type="button" size="sm" className="btn-ghost" onClick={onClearSelect}>取消</Button>
          </div>
          {/* key 與選取狀態都用筆記 id，不用陣列索引（FE-11）：刪除中間某一頁之後，索引會指到不同的筆記，選取的內容就會跟著錯位。
              頁碼仍然用 index 顯示（那本來就是「目前第幾頁」的意思，跟身分無關）。 */}
          <ul className="note-page-list">
            {notes.map((note, index) => (
              <PageCard
                key={note.id}
                note={note}
                index={index}
                isCurrent={index === currentPage}
                // 只有「目前這頁」的名稱需要未儲存的星號；其他頁一律傳 false，isDirty 變動時 199 張卡的 props 不變、不會重繪
                dirty={isDirty && index === currentPage}
                checked={selectedSet.has(note.id)}
                unsynced={Boolean(unsyncedSet?.has(note.id))}
                onSelect={handleSelect}
                onToggle={handleToggle}
              />
            ))}
          </ul>

          {/* 分享按鈕始終顯示（原本要先勾選才出現，使用者找不到分享在哪）。沒勾選時用 aria-disabled
              而不是 disabled：按鈕仍可被鍵盤聚焦，報讀器會一併唸出下面的原因說明。 */}
          <div className="note-rail-share">
            <Button
              type="button"
              className={`btn-primary w-100${noneSelected ? " disabled" : ""}`}
              onClick={() => { if (!noneSelected) onShare(); }}
              disabled={isSharing}
              aria-disabled={noneSelected || undefined}
              aria-describedby={noneSelected ? "note-share-hint" : undefined}
            >
              {isSharing ? "分享中…" : "分享"}
            </Button>
            {noneSelected && (
              <div id="note-share-hint" className="ns-select-hint mt-1">請先勾選上方要分享的頁面。</div>
            )}
          </div>
          </div>
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
