import "../../static/css/ui/emptyState.css";

/**
 * 沒有資料時的共用空狀態（審查項 P1-12）：說明「為什麼是空的」、「現在可以做什麼」。
 * 不用 role=status／alert：搜尋結果的筆數已由 announce() 另外公告，這裡只負責畫面上的說明，
 * 避免同一件事被唸兩次。
 *
 * title：一句話說明現況；children：補充說明（可放條件摘要、建議清單）；actions：按鈕列。
 */
export default function EmptyState({ title, children, actions, className = '' }) {
  return (
    <section className={`yy-empty ${className}`.trim()}>
      <h2 className="yy-empty__title">{title}</h2>
      {children && <div className="yy-empty__body">{children}</div>}
      {actions && <div className="yy-empty__actions">{actions}</div>}
    </section>
  );
}
