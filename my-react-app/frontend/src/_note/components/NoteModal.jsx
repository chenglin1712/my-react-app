import DOMPurify from "dompurify";
import { useState } from "react";

const REPORT_REASONS = [
  { value: "inappropriate", label: "不當內容" },
  { value: "wrong_content", label: "內容錯誤" },
  { value: "spam", label: "垃圾內容" },
  { value: "other", label: "其他" },
];

/** 分享筆記的詳情彈窗（點卡片或從分享連結進入都會開這個）。
 *
 * 檢舉按鈕刻意不像 canLike／canDelete 那樣依登入狀態隱藏——未登入訪客
 * （例如透過 /share/:id 公開連結進來的人）也看得到，點擊後由 onReport
 * 自行判斷登入狀態並導去 /login（跟 noteshare.jsx 的 toggleLike 同一種
 * 「先讓看得到，點了才擋」的處理方式），而不是像按讚那樣直接不給看到入口。
 */
export default function NoteModal({ note, canLike, iLike, canDelete, onToggleLike, onDelete, onClose, onReport }) {
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState("inappropriate");
  const [reportText, setReportText] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const submitReport = async () => {
    if (reportReason === "other" && !reportText.trim()) return;
    setReportSubmitting(true);
    try {
      await onReport(note, reportReason, reportReason === "other" ? reportText.trim() : "");
      setShowReportForm(false);
      setReportReason("inappropriate");
      setReportText("");
    } finally {
      setReportSubmitting(false);
    }
  };

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
          <button className="ns-btn" onClick={() => setShowReportForm((v) => !v)}>
            檢舉
          </button>
          <button className="ns-btn" onClick={onClose}>
            關閉
          </button>
        </div>

        {showReportForm && (
          <div className="ns-report-form">
            <p className="ns-report-title">請選擇檢舉原因</p>
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className="ns-report-option">
                <input
                  type="radio"
                  name="note-report-reason"
                  value={r.value}
                  checked={reportReason === r.value}
                  onChange={(e) => setReportReason(e.target.value)}
                />
                {r.label}
              </label>
            ))}
            {reportReason === "other" && (
              <textarea
                className="ns-report-text"
                placeholder="請簡短說明檢舉原因"
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                maxLength={500}
                aria-label="補充說明"
              />
            )}
            <div className="ns-report-actions">
              <button
                className="ns-btn"
                disabled={reportSubmitting}
                onClick={() => setShowReportForm(false)}
              >
                取消
              </button>
              <button
                className="ns-btn danger"
                disabled={reportSubmitting || (reportReason === "other" && !reportText.trim())}
                onClick={submitReport}
              >
                {reportSubmitting ? "送出中…" : "送出檢舉"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
