// 「討論」「AI助手」目前都還沒有真正可用：討論分頁全部是寫死的假資料
// （送出留言只會存在瀏覽器記憶體裡，重新整理就消失，回覆按鈕完全沒有接
// 事件），AI助手則收不到使用者選的題目脈絡，兩者都先標示成「即將推出」，
// 不讓使用者以為這是可以真的使用的功能。
const NAV_ITEMS = [
  { label: "測驗紀錄", comingSoon: false },
  { label: "討論", comingSoon: true },
  { label: "AI助手", comingSoon: true },
];

export default function ReviewTabs({ activeIndex, onChange, hasSelectedQuestion }) {
  return (
    <div className="review-nav">
      {NAV_ITEMS.map((navItem, index) => {
        const isDisabled = navItem.comingSoon || (index > 0 && !hasSelectedQuestion);
        return (
          <button
            type="button"
            key={navItem.label}
            className={`nav-item ${activeIndex === index ? "active" : ""} ${isDisabled ? "disabled" : ""}`}
            onClick={() => { if (!isDisabled) onChange(index); }}
            disabled={isDisabled}
          >
            {navItem.label}
            {navItem.comingSoon && <span className="nav-item-badge">即將推出</span>}
          </button>
        );
      })}
    </div>
  );
}
