import { Button, Form } from "react-bootstrap";

/** 右側「分享頁面選擇」清單：勾選要分享的頁面、全選/取消、送出分享。 */
export default function PageSidebar({ notes, currentPage, isDirty, selectedPageIds, onToggleSelect, onSelectAll, onClearSelect, onShare }) {
  return (
    <>
      <h5 className="mt-2">分享頁面選擇</h5>
      <div className="mb-2 d-flex gap-2">
        <Button size="sm" className="btn-ghost" onClick={onSelectAll}>全選</Button>
        <Button size="sm" className="btn-ghost" onClick={onClearSelect}>取消</Button>
      </div>
      <Form>
        {/* key 與選取狀態都用筆記 id，不用陣列索引（FE-11）：刪除中間某一頁
            之後，索引會指到不同的筆記，選取的內容就會跟著錯位。頁碼仍然用
            index 顯示（那本來就是「目前第幾頁」的意思，跟身分無關）。 */}
        {notes.map((note, index) => (
          <Form.Check
            key={note.id}
            id={`note-page-select-${note.id}`}
            type="checkbox"
            label={`第 ${index + 1} 頁：${note.title || "（未命名）"}${index === currentPage && isDirty ? "*" : ""}`}
            checked={selectedPageIds.includes(note.id)}
            onChange={() => onToggleSelect(note.id)}
            className="mb-1"
          />
        ))}
      </Form>

      {selectedPageIds.length > 0 && (
        <Button
          className="btn-primary mt-2 w-100"
          onClick={onShare}
        >
          分享
        </Button>
      )}
    </>
  );
}
