import { Button, Form } from "react-bootstrap";

/** 右側「分享頁面選擇」清單：勾選要分享的頁面、全選/取消、送出分享。 */
export default function PageSidebar({ notes, currentPage, isDirty, selectedPages, onToggleSelect, onSelectAll, onClearSelect, onShare }) {
  return (
    <>
      <h5 className="mt-2">分享頁面選擇</h5>
      <div className="mb-2 d-flex gap-2">
        <Button size="sm" className="btn-ghost" onClick={onSelectAll}>全選</Button>
        <Button size="sm" className="btn-ghost" onClick={onClearSelect}>取消</Button>
      </div>
      <Form>
        {notes.map((note, index) => (
          <Form.Check
            key={index}
            id={`note-page-select-${index}`}
            type="checkbox"
            label={`第 ${index + 1} 頁：${note.title || "（未命名）"}${index === currentPage && isDirty ? "*" : ""}`}
            checked={selectedPages.includes(index)}
            onChange={() => onToggleSelect(index)}
            className="mb-1"
          />
        ))}
      </Form>

      {selectedPages.length > 0 && (
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
