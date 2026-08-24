import { Heart } from "lucide-react";
import DOMPurify from "dompurify";
import { timeAgo } from "../timeAgo";

/**
 * 分享筆記格線裡的單張卡片。整張卡片可點擊開啟詳情，但裡面還有一顆獨立的
 * 讚按鈕——HTML 不允許 button 巢狀 button，所以「開啟詳情」跟「按讚」是兩顆
 * 平行的 button，不是外層 div 包內層 button（也讓整張卡片能用鍵盤操作）。
 */
export default function NoteCard({ note, isMyTab, isMine, iLike, onOpen, onToggleLike }) {
  return (
    <article className="ns-card">
      <button type="button" className="ns-card-open" onClick={() => onOpen(note)}>
        <div className="ns-card-head">
          {note.avatarUrl ? (
            <img src={note.avatarUrl} alt="" className="ns-avatar" loading="lazy" />
          ) : (
            <div className="ns-avatar ns-avatar-fallback" aria-hidden="true">👤</div>
          )}

          <div className="ns-meta">
            <div className="ns-username">{note.username || "使用者名稱"}</div>
            <div className="ns-time">{timeAgo(note.createdAt)}</div>
          </div>

          {isMyTab && isMine && <span className="ns-edit">編輯</span>}
        </div>

        <div className="ns-card-body">
          <div className="ns-title">
            {note.pages?.[0]?.title || "標題"}
          </div>
          <div
            className="ns-preview"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(note.preview || "<p>內容</p>"),
            }}
          />
        </div>
      </button>

      <div className="ns-like-row">
        <button
          type="button"
          className={`ns-like-btn ${iLike ? "is-liked" : ""}`}
          onClick={(e) => onToggleLike(e, note, "card")}
          aria-label={iLike ? "取消按讚" : "按讚"}
        >
          <Heart size={20} fill={iLike ? "red" : "none"} /><span>{note.likes ?? 0}</span>
        </button>
      </div>
    </article>
  );
}
