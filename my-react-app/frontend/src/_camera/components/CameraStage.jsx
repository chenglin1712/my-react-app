import "../../../static/css/_camera/stage.css";

// 影像辨識的「舞台」（P3-5）：圖片固定在這裡，辨識出的詞以標籤浮在圖上，不換頁。
// - 後端（Google Cloud Vision LABEL_DETECTION）只回「標籤與分數」，沒有物件在圖上的座標，
//   所以標籤是排在圖的下緣，不是貼在物件旁邊；畫面上也不畫框，避免暗示有定位。
// - scanning：一道光帶由上掃到下，只掃一次（不無限循環）；之後靠 hint 的文字說明進度。減少動態時不掃，只有文字。
// - hint：舞台上方的狀態提示（取代原本分頁式的步驟條），純文字，不是 live region（公告由各步驟用 announce 負責）。
// - compact：結果頁用的矮版舞台。
// - children：浮在圖上的標籤清單（<ul>）。
const CameraStage = ({ image, scanning = false, hint, compact = false, children }) => (
    <div className={`camera-stage${compact ? " is-compact" : ""}${scanning ? " is-scanning" : ""}`}>
        {image && <img decoding="async" src={image} alt="預覽圖片" className="camera-stage-img" />}
        {scanning && (
            <span className="camera-scan" aria-hidden="true">
                <span className="camera-scan-beam" />
            </span>
        )}
        {hint && <p className="camera-stage-hint yy-glass">{hint}</p>}
        {children && <div className="camera-stage-layer">{children}</div>}
    </div>
);

export default CameraStage;
