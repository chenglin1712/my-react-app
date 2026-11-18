import "../../../static/css/_note/syncstatus.css";

// 「已儲存於 12:03」：24 小時制的時:分（不是「3 分鐘前」這種會一直變的相對時間，使用者要的是一個確定的時間點）
const formatClock = (ms) => new Date(ms).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * 筆記存檔狀態（取代原本側欄標題後面只有一個 * 號的提示）。
 * 筆記是按「儲存」（或換頁、雲端同步開啟時由同步流程）才寫進這台裝置，所以「尚未儲存」是真實的狀態。
 * 這裡只講「這台裝置」的儲存，不論雲端同步有沒有開；有沒有上雲端由旁邊的 SyncStatus 負責，
 * 兩者分開講，離線或同步失敗時才不會出現「已儲存」跟「同步失敗」互相打架。
 * 時間是固定的時間點，不會自己跳動，所以不需要計時器，報讀器也不會被一直打斷。
 */
export default function SaveStatus({ isDirty, storageError, lastSavedAt, cloudSyncOn }) {
  let state = "idle";
  let label;
  if (storageError) {
    state = "error";
    label = "沒有儲存到這台裝置";
  } else if (isDirty) {
    state = "dirty";
    label = "尚未儲存";
  } else if (lastSavedAt) {
    state = "saved";
    label = `已儲存於 ${formatClock(lastSavedAt)}（這台裝置）`;
  } else {
    label = "筆記儲存在這台裝置";
  }

  return (
    <div className="note-save">
      <p className="note-save__status" data-state={state}>
        <span role="status">{label}</span>
      </p>
      {!cloudSyncOn && (
        <p className="note-save__hint">筆記只存在這台裝置的瀏覽器，換裝置或清除瀏覽器資料後就看不到了。</p>
      )}
    </div>
  );
}
