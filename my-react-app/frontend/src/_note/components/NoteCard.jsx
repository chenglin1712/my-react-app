import { useMemo, useState } from "react";
import { FileText, Heart, User } from "lucide-react";
import { sanitizeNoteHtml } from "@utils/sanitizeNoteHtml";
import { timeAgo } from "../timeAgo";
import { firstImageSrc, isCloudinaryUrl, stripImages } from "../noteCover";

/**
 * 分享筆記格線裡的單張卡片。整張卡片可點選開啟詳情，但裡面還有一顆獨立的
 * 讚按鈕——HTML 不允許 button 巢狀 button，所以「開啟詳情」跟「按讚」是兩顆
 * 平行的 button，不是外層 div 包內層 button（也讓整張卡片能用鍵盤操作）。
 */
export default function NoteCard({ note, isMyTab, isMine, iLike, onOpen, onToggleLike }) {
  // 預覽只在 preview 內容變動時才重新消毒；列表上按一個讚時，其他卡片的預覽不必再處理一遍。
  const { previewHtml, coverSrc } = useMemo(() => {
    const raw = note.preview || "<p>內容</p>";
    // 兩份都要經過消毒器：封面從消毒後的結果取圖；預覽文字是「先去掉圖片再消毒」，
    // 不在消毒之後再改寫 HTML（改寫過的結果不保證還是安全的）
    return {
      previewHtml: sanitizeNoteHtml(stripImages(raw), { strictImages: true }),
      // 優先用分享時存的 image 欄位（preview 會先去掉圖片，所以新分享的筆記封面只能靠它）；舊資料才從 preview 找（FE6-08）
      coverSrc: (isCloudinaryUrl(note.image) ? note.image : null)
        ?? firstImageSrc(sanitizeNoteHtml(raw, { strictImages: true })),
    };
  }, [note.preview, note.image]);
  // 記下「哪一個網址載入失敗」而不是單一布林值：同一張卡片換成另一則筆記或新封面時，不會被舊的失敗狀態卡住
  const [failedSrc, setFailedSrc] = useState(null);
  const title = note.pages?.[0]?.title?.trim() || "（未命名）";
  const likes = note.likes ?? 0;
  const coverFailed = coverSrc !== null && failedSrc === coverSrc;
  return (
    <article className="ns-card">
      <button type="button" className="ns-card-open" onClick={() => onOpen(note)}>
        {/* 封面（16:9）：筆記裡第一張圖；沒有圖或載入失敗就畫預設封面，每張卡片的封面高度一律相同 */}
        <div className="ns-cover" aria-hidden="true">
          {coverSrc && !coverFailed ? (
            <img decoding="async" src={coverSrc} alt="" loading="lazy" onError={() => setFailedSrc(coverSrc)} />
          ) : (
            <span className="ns-cover-fallback"><FileText size={28} /></span>
          )}
        </div>
        <div className="ns-card-head">
          {note.avatarUrl ? (
            <img decoding="async" src={note.avatarUrl} alt="" className="ns-avatar" loading="lazy" />
          ) : (
            <div className="ns-avatar ns-avatar-fallback" aria-hidden="true"><User size={18} /></div>
          )}

          <div className="ns-meta">
            <div className="ns-username">{note.username || "使用者名稱"}</div>
            <div className="ns-time">{timeAgo(note.createdAt)}</div>
          </div>

          {/* 稽核 FE6-15：分享後的筆記沒有編輯功能（詳情只有刪除、檢舉、關閉），標「編輯」會誤導；
              改成中性的狀態標籤。沿用 ns-edit 樣式 */}
          {isMyTab && isMine && <span className="ns-edit">我的分享</span>}
        </div>

        <div className="ns-card-body">
          <div className="ns-title" title={note.pages?.[0]?.title?.trim() || undefined}>
            {note.pages?.[0]?.title?.trim() || "（未命名）"}
          </div>
          <div
            className="ns-preview"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </button>

      <div className="ns-like-row">
        {isMine ? (
          // 稽核 FE6-17：自己的筆記不能按讚（toggleLike 直接 return、沒有回饋），所以只顯示讚數、不渲染按鈕
          <span className="ns-like-btn is-own" role="img" aria-label={`${title}，目前 ${likes} 個讚`}>
            <Heart size={20} aria-hidden="true" /><span aria-hidden="true">{likes}</span>
          </span>
        ) : (
          // 稽核 FE6-17：aria-label 原本只有「按讚」，會蓋掉內部的讚數、也不知道是哪一則；
          // 現在帶筆記標題與讚數（含可見的數字，語音控制唸得到），狀態用 aria-pressed
          <button
            type="button"
            className={`ns-like-btn ${iLike ? "is-liked" : ""}`}
            onClick={(e) => onToggleLike(e, note, "card")}
            aria-pressed={iLike}
            aria-label={`${iLike ? "收回讚" : "按讚"}：${title}，目前 ${likes} 個讚`}
          >
            <Heart size={20} fill={iLike ? "red" : "none"} aria-hidden="true" /><span aria-hidden="true">{likes}</span>
          </button>
        )}
      </div>
    </article>
  );
}
