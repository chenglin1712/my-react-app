import DOMPurify from "dompurify";

/** 分享筆記的詳情彈窗（點卡片或從分享連結進入都會開這個）。 */
export default function NoteModal({ note, canLike, iLike, canDelete, onToggleLike, onDelete, onClose }) {
  return (
    <div className="ns-modal-mask" onClick={onClose}>
      <div className="ns-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="ns-modal-title">{note.pages[0].title || "筆記內容"}</h2>
        <p className="ns-modal-sub">
          分享者：{note.username || "匿名者"} ❤️ {note.likes || 0}
        </p>

        {canLike && (
          <div style={{ marginBottom: "0.75rem" }}>
            <button
              className={`ns-like-btn ${iLike ? "is-liked" : ""}`}
              onClick={(e) => onToggleLike(e, note, "modal")}
            >
              {iLike ? "收回讚" : "按讚"}
            </button>
          </div>
        )}

        {(note.pages || []).map((pg, i) => (
          <div key={i} className="ns-modal-page">
            <div className="ns-page-label">第 {i + 1} 頁</div>
            <div
              className="ns-modal-content"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(pg.content) }}
            />
          </div>
        ))}

        <div className="ns-modal-actions">
          {canDelete && (
            <button className="ns-btn danger" onClick={onDelete}>
              刪除筆記
            </button>
          )}
          <button className="ns-btn" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
