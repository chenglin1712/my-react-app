import { Button } from "react-bootstrap";
import { noteTitle } from "../sync/noteSyncCore";
import "../../../static/css/_note/syncstatus.css";

const STATUS_TEXT = {
  connecting: "正在連線到雲端…",
  synced: "已同步到雲端",
  saving: "正在同步到雲端…",
  offline: "目前離線，修改先存在這個裝置，連線後會自動同步。",
  error: "雲端同步暫時無法使用，筆記仍存在這個裝置。",
};

/**
 * 雲端同步的狀態、衝突提示與同步失敗的頁面（D-2／D-3）。只有雲端同步開啟時才會顯示。
 * 失敗的頁面一律保留在這個裝置，可以重試，也可以先匯出成檔案帶走。
 */
export default function SyncStatus({ sync, notes, onExport }) {
  if (!sync || sync.status === "off") return null;

  const { status, progress, notices, failures } = sync;
  const statusText = status === "saving" && progress && progress.total > 1
    ? `正在把這個裝置上的筆記上傳到雲端（${progress.done} / ${progress.total}）`
    : STATUS_TEXT[status];
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const visibleFailures = failures.filter((failure) => noteById.has(failure.id));

  return (
    <section className="note-sync" aria-label="雲端同步">
      {/* role=status 本身就是 aria-live=polite：狀態變化會被報讀，不會打斷正在輸入的人 */}
      <p className="note-sync__status" role="status" data-status={status}>{statusText}</p>

      {notices.map((notice) => (
        <div key={notice.key} className="note-sync__notice" role="status">
          <span>{notice.message}</span>
          <Button type="button" size="sm" className="btn-ghost" onClick={() => sync.dismissNotice(notice.key)}>知道了</Button>
        </div>
      ))}

      {visibleFailures.length > 0 && (
        <div className="note-sync__failures">
          <p className="note-sync__failures-title">
            有 {visibleFailures.length} 頁還沒同步到雲端，內容都還在這個裝置上。
          </p>
          <ul className="note-sync__failure-list">
            {visibleFailures.map((failure) => {
              const note = noteById.get(failure.id);
              return (
                <li key={failure.id} className="note-sync__failure">
                  <div className="note-sync__failure-text">
                    <strong>{noteTitle(note)}</strong>
                    <span>{failure.message}</span>
                  </div>
                  <div className="note-sync__failure-actions">
                    <Button type="button" size="sm" className="btn-primary" onClick={() => sync.retry(failure.id)}>重試</Button>
                    <Button type="button" size="sm" className="btn-ghost" onClick={() => onExport(note)}>匯出此頁</Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {visibleFailures.length > 1 && (
            <Button type="button" size="sm" className="btn-ghost" onClick={sync.retryAll}>全部重試</Button>
          )}
        </div>
      )}
    </section>
  );
}
