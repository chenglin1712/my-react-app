import '../../../static/css/_admin/admin-entry.css';

// 五段訊號環：紅／金／藍／青／米，對應前台 Y2K 配色。環的半徑 36（周長約 226.2），每段 38、段間約 7.2。
const SEGMENTS = ['red', 'gold', 'blue', 'teal', 'cream'];

/**
 * 後台入口的載入畫面：後台主程式（lazy chunk）或登入狀態還沒就緒時顯示。
 *
 * - 兩種用法：預設（instant=false）是各處 Suspense／登入確認的後備畫面，延遲約 120ms 才淡入，載入很快時不會閃一下；
 *   instant 是 AdminEntryGate 的入口儀式，一開始就顯示，最短可見時間與收合轉場由 Gate 控制；leaving 是光圈收合階段。
 * - 不假造百分比。
 * - 全部動畫只用 transform／opacity（進度帶用 background-position），沒有 blur 或 filter。
 * - 降低動態偏好由 theme-v2.css 的全域規則處理（動畫直接到終態）。
 */
const AdminEntryFallback = ({ message = '正在校準管理訊號', instant = false, leaving = false }) => (
    <div className={`admin-entry${instant ? ' admin-entry--instant' : ''}${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite">
        <div className="admin-entry-core" aria-hidden="true">
            <svg className="admin-entry-ring" viewBox="0 0 100 100" focusable="false">
                {SEGMENTS.map((tone, index) => (
                    // 旋轉放在外層 <g>：CSS 動畫的 transform 會蓋掉 SVG 的 transform 屬性，圓弧本身只做 opacity
                    <g key={tone} transform={`rotate(${index * 72 - 90} 50 50)`}>
                        <circle
                            className={`admin-entry-segment admin-entry-segment-${tone}`}
                            cx="50"
                            cy="50"
                            r="36"
                            style={{ animationDelay: `${0.12 + index * 0.08}s` }}
                        />
                    </g>
                ))}
            </svg>
            <span className="admin-entry-mark">源</span>
        </div>
        <p className="admin-entry-brand" aria-hidden="true">YUAN・YU ADMIN</p>
        <p className="admin-entry-message">{message}</p>
        <div className="admin-entry-bar" aria-hidden="true" />
    </div>
);

export default AdminEntryFallback;
