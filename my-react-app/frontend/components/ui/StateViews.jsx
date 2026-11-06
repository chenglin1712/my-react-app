import "../../static/css/ui/stateViews.css";
import useDelayedVisible from "../../hooks/useDelayedVisible";

/**
 * 三態的「載入」與「錯誤」共用元件（空狀態見 EmptyState）。
 *
 * - SkeletonBlocks：用接近實際內容的尺寸排佔位塊，載入完成時版面不跳動。
 *   整組是一個 role="status"，只有一句看不見的說明，每個塊本身 aria-hidden。
 * - DelayedSkeleton：超過 delay（預設 1 秒）才顯示骨架，之前只留一個空的忙碌區，避免快速載入時閃爍。
 * - ErrorState：說明哪裡出錯＋重試鈕；role="alert"，沒有 onRetry 就不放按鈕。
 */
export function SkeletonBlocks({ label = "載入中…", rows = [56, 56, 56], className = "", blockClassName = "" }) {
  return (
    <div className={`yy-skeleton-group ${className}`.trim()} role="status">
      <span className="visually-hidden">{label}</span>
      {rows.map((height, index) => (
        <span
          className={`yy-skeleton yy-skeleton-group__block ${blockClassName}`.trim()}
          style={{ height: typeof height === "number" ? `${height}px` : height }}
          aria-hidden="true"
          key={index}
        />
      ))}
    </div>
  );
}

export function DelayedSkeleton({ delay = 1000, label = "載入中…", ...skeletonProps }) {
  const show = useDelayedVisible(true, delay);
  // 說明文字一開始就在（status 區域），報讀器馬上有回饋；只有看得見的骨架塊延遲出現
  if (!show) {
    return (
      <div className="yy-skeleton-wait" role="status" aria-busy="true">
        <span className="visually-hidden">{label}</span>
      </div>
    );
  }
  return <SkeletonBlocks label={label} {...skeletonProps} />;
}

export function ErrorState({ title = "目前無法載入，請稍後再試。", onRetry, retryLabel = "重新載入", className = "", buttonClassName = "" }) {
  return (
    <div className={`yy-state yy-state--error ${className}`.trim()} role="alert">
      <p className="yy-state__title">{title}</p>
      {onRetry && (
        <button type="button" className={`yy-state__btn ${buttonClassName}`.trim()} onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
