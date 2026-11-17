import "../../static/css/ui/skeletonShapes.css";

/**
 * 貼合最終版面的骨架（P1-4）：詞卡、筆記卡、筆記編輯頁、翻譯結果。遊戲入口是靜態卡片、沒有載入狀態，所以沒有遊戲卡骨架。
 * 取代整區轉圈；高度與對應元件的實際高度一致，載入完成時內容不跳動。
 * 每組是一個 role="status"，只有一句看不見的說明，每個塊本身 aria-hidden。
 * 動畫沿用 .yy-skeleton 的脈動；減少動態偏好下由全站規則停在終態（靜止）。
 */
const Bar = ({ className = "" }) => <span className={`yy-skeleton ${className}`.trim()} aria-hidden="true" />;

/** 查詢結果的詞卡列表：詞、釋義、星等與按鈕列。count 是同時顯示幾張。 */
export function WordCardSkeleton({ count = 4, label = "搜尋中…" }) {
  return (
    <div className="yy-sk-list" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="yy-sk-wordcard" aria-hidden="true" key={i}>
          <Bar className="yy-sk-wordcard__name" />
          <Bar className="yy-sk-wordcard__gloss" />
          <Bar className="yy-sk-wordcard__meta" />
          <Bar className="yy-sk-wordcard__example" />
        </div>
      ))}
    </div>
  );
}

/** 筆記分享區的卡片格（欄數與 .ns-grid 相同）：頭像與名稱、標題、兩行預覽。 */
export function NoteCardSkeleton({ count = 6, label = "載入筆記中…" }) {
  return (
    <div className="yy-sk-notegrid" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <div className="yy-sk-notecard" aria-hidden="true" key={i}>
          <div className="yy-sk-notecard__head">
            <Bar className="yy-sk-notecard__avatar" />
            <div className="yy-sk-notecard__who">
              <Bar className="yy-sk-line yy-sk-line--short" />
              <Bar className="yy-sk-line yy-sk-line--xshort" />
            </div>
          </div>
          <Bar className="yy-sk-line yy-sk-line--title" />
          <Bar className="yy-sk-line" />
          <Bar className="yy-sk-line yy-sk-line--short" />
        </div>
      ))}
    </div>
  );
}

/** 筆記編輯頁：工具列一條加一張頁面。 */
export function NoteEditorSkeleton({ label = "載入筆記中…" }) {
  return (
    <div className="yy-sk-editor" role="status">
      <span className="visually-hidden">{label}</span>
      <Bar className="yy-sk-editor__toolbar" />
      <Bar className="yy-sk-editor__page" />
    </div>
  );
}

/** 翻譯結果欄：幾行譯文。 */
export function TranslateResultSkeleton({ lines = 4, label = "翻譯中…" }) {
  return (
    <div className="yy-sk-translate" role="status">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <Bar className={`yy-sk-line${i === lines - 1 ? " yy-sk-line--short" : ""}`} key={i} />
      ))}
    </div>
  );
}
