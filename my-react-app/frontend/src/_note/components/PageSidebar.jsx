import { useMemo } from "react";
import { Button, Form } from "react-bootstrap";

// 取出筆記內容的純文字預覽（卡片只顯示前幾行，CSS 截斷）。
// 不用 HTML parser（img/iframe 的 src 會被預先載入）：先砍掉 script/style 整段，再去標籤，最後只還原常見實體。
const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const previewText = (html) => {
    if (!html) return "";
    return String(html)
        .slice(0, 2000)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
};

/** 右側「分享頁面選擇」清單：勾選要分享的頁面、全選/取消、送出分享。 */
export default function PageSidebar({
  notes, currentPage, isDirty, selectedPageIds, maxSelectable,
  onToggleSelect, onSelectAll, onClearSelect, onShare, isSharing, unsyncedIds,
}) {
  const overLimit = maxSelectable != null && notes.length > maxSelectable;
  const noneSelected = selectedPageIds.length === 0;
  // 內容沒變就不重算（選取、dirty 等狀態變動不重新解析每篇筆記）
  const previews = useMemo(() => Object.fromEntries(notes.map((n) => [n.id, previewText(n.content)])), [notes]);

  return (
    <>
      <h5 className="mt-2">分享頁面選擇</h5>
      {maxSelectable != null && (
        <div className="ns-select-hint mb-1">
          已選 {selectedPageIds.length} / 上限 {maxSelectable} 頁
          {overLimit && `（共 ${notes.length} 頁，全選只會勾選前 ${maxSelectable} 頁）`}
        </div>
      )}
      <div className="mb-2 d-flex gap-2">
        <Button type="button" size="sm" className="btn-ghost" onClick={() => onSelectAll(maxSelectable)}>全選</Button>
        <Button type="button" size="sm" className="btn-ghost" onClick={onClearSelect}>取消</Button>
      </div>
      <Form className="note-page-list">
        {/* key 與選取狀態都用筆記 id，不用陣列索引（FE-11）：刪除中間某一頁
            之後，索引會指到不同的筆記，選取的內容就會跟著錯位。頁碼仍然用
            index 顯示（那本來就是「目前第幾頁」的意思，跟身分無關）。 */}
        {notes.map((note, index) => {
          const preview = previews[note.id];
          const isCurrent = index === currentPage;
          const checked = selectedPageIds.includes(note.id);
          return (
            // 每一頁是一張卡片（Apple 化步驟 4-8）：勾選框與標題在上，預覽在下；
            // 已勾選的卡片多一圈強調框，目前編輯的那頁有「目前」標籤，都不只靠顏色。
            <div key={note.id} className={`note-page-card${checked ? " is-selected" : ""}${isCurrent ? " is-current" : ""}`}>
              <Form.Check
                id={`note-page-select-${note.id}`}
                type="checkbox"
                label={`第 ${index + 1} 頁：${note.title || "（未命名）"}${isCurrent && isDirty ? "*" : ""}${unsyncedIds?.includes(note.id) ? "（未同步）" : ""}`}
                checked={checked}
                onChange={() => onToggleSelect(note.id)}
                aria-describedby={preview ? `note-page-preview-${note.id}` : undefined}
              />
              {isCurrent && <span className="note-page-badge">目前編輯</span>}
              {preview && <p id={`note-page-preview-${note.id}`} className="note-page-preview">{preview}</p>}
            </div>
          );
        })}
      </Form>

      {/* 分享按鈕始終顯示（原本要先勾選才出現，使用者找不到分享在哪）。沒勾選時用 aria-disabled
          而不是 disabled：按鈕仍可被鍵盤聚焦，報讀器會一併唸出下面的原因說明。 */}
      <Button
        type="button"
        className={`btn-primary mt-2 w-100${noneSelected ? " disabled" : ""}`}
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
    </>
  );
}
