import { Heart } from "lucide-react";
import DOMPurify from "dompurify";
import { timeAgo } from "../timeAgo";

/** 分享筆記格線裡的單張卡片。 */
export default function NoteCard({ note, isMyTab, isMine, iLike, onOpen, onToggleLike }) {
  return (
    <div className="ns-card" onClick={() => onOpen(note)}>
      <div className="ns-card-head">
        {note.avatarUrl ? (
          <img src={note.avatarUrl} alt="avatar" className="ns-avatar" loading="lazy" />
        ) : (
          <div className="ns-avatar ns-avatar-fallback">👤</div>
        )}

        <div className="ns-meta">
          <div className="ns-username">{note.username || "使用者名稱"}</div>
          <div className="ns-time">{timeAgo(note.createdAt)}</div>
        </div>

        {isMyTab && isMine && <span className="ns-edit">編輯</span>}
      </div>

      <div className="ns-card-body">
        <div className="ns-title">
          {note.pages && note.pages.length > 0
            ? note.pages[0].title || "標題"
            : "標題"}
        </div>
        <div
          className="ns-preview"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(note.preview || "<p>內容</p>"),
          }}
        />
        <div className="ns-like-row">
          <button
            className={`ns-like-btn ${iLike ? "is-liked" : ""}`}
            onClick={(e) => onToggleLike(e, note, "card")}
            aria-label={iLike ? "取消按讚" : "按讚"}
          >
            <Heart size={20} fill={iLike ? "red" : "none"} /><span>{note.likes || 0}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
