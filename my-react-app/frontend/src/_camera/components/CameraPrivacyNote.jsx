import { useId, useState } from "react";
import { Info } from "lucide-react";

const STORAGE_KEY = "yy-camera-privacy-seen";

const readSeen = () => {
    try {
        return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
};

// 隱私說明（P3-9）：第一次來顯示完整說明卡；按「我知道了」之後收成一顆資訊鈕，隨時可再展開。
// 說明全文一字不少（含「會送到 Google Cloud Vision」），只是不再每次都佔一大段版面。
// 「已看過」只記在這台裝置的瀏覽器（localStorage）；讀寫失敗（無痕、被封鎖）就當作沒看過，每次都顯示完整說明。
const CameraPrivacyNote = () => {
    const [seen, setSeen] = useState(readSeen);
    const [open, setOpen] = useState(false);
    const bodyId = useId();
    const expanded = !seen || open;

    const acknowledge = () => {
        try {
            localStorage.setItem(STORAGE_KEY, "1");
        } catch {
            /* 記不起來就算了：下次進來會再顯示一次 */
        }
        setSeen(true);
        setOpen(false);
    };

    return (
        <div className={`camera-privacy-card${expanded ? " is-open" : ""}`}>
            {seen && (
                <button
                    type="button"
                    className="camera-privacy-toggle"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => setOpen((v) => !v)}
                >
                    <Info size={16} className="yy-icon" aria-hidden="true" />
                    隱私說明
                </button>
            )}
            <div id={bodyId} hidden={!expanded}>
                <p className="camera-privacy">
                    按下「提交辨識」後，圖片會上傳到本站伺服器，並送到 Google Cloud Vision 辨識圖中的物件。請避免上傳含有人臉、證件或個人資料的照片。
                </p>
                {!seen && (
                    <button type="button" className="yy-btn-outline camera-privacy-ack" onClick={acknowledge}>
                        我知道了
                    </button>
                )}
            </div>
        </div>
    );
};

export default CameraPrivacyNote;
