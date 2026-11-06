import '../../../static/css/_admin/admin-entry.css';

/**
 * 後台入口的載入畫面：後台主程式（lazy chunk）或登入狀態還沒就緒時顯示。
 * 視覺與前台啟動畫面（index.html 的 .boot-shell）同一語言：象牙底、置中的字標、底部一條細線來回滑動。
 *
 * - 兩種用法：預設（instant=false）是各處 Suspense／登入確認的後備畫面，延遲約 120ms 才淡入，載入很快時不會閃一下；
 *   instant 是 AdminEntryGate 的入口儀式，一開始就顯示，最短可見時間與收合轉場由 Gate 控制；leaving 是淡出收合階段。
 * - 不假造百分比。
 * - 全部動畫只用 transform／opacity，沒有 blur 或 filter。
 * - 降低動態偏好由 theme-v2.css 的全域規則處理（動畫直接到終態）。
 */
const AdminEntryFallback = ({ message = '正在載入管理後台', instant = false, leaving = false, onSkip }) => (
    <div className={`admin-entry${instant ? ' admin-entry--instant' : ''}${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite">
        <p className="admin-entry-name" aria-hidden="true">原語</p>
        <p className="admin-entry-brand" aria-hidden="true">管理後台</p>
        <p className="admin-entry-message">{message}</p>
        {onSkip && !leaving && <button type="button" className="admin-entry-skip" onClick={onSkip}>略過</button>}
        <div className="admin-entry-bar" aria-hidden="true"><b /></div>
    </div>
);

export default AdminEntryFallback;
