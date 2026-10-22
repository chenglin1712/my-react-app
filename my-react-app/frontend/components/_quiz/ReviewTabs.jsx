// 「討論」目前還沒有真正可用：全部是寫死的假資料（送出留言只會存在瀏覽器記憶體裡，
// 重新整理就消失，回覆按鈕完全沒有接事件），先標示成「即將推出」。
// 「AI助手」現在收得到選到的題目（路線圖 #22），但費用與品質要真金鑰驗收後才開放：
// 由後端功能旗標 ai_question_review_enabled（預設關閉）決定，aiEnabled 為 false 時維持「即將推出」。
const NAV_ITEMS = [
  { label: "測驗紀錄", comingSoon: () => false },
  { label: "討論", comingSoon: () => true },
  { label: "AI助手", comingSoon: (aiEnabled) => !aiEnabled },
];

export default function ReviewTabs({ activeIndex, onChange, hasSelectedQuestion, aiEnabled = false }) {
  return (
    <div className="review-nav">
      {NAV_ITEMS.map((navItem, index) => {
        const comingSoon = navItem.comingSoon(aiEnabled);
        const isDisabled = comingSoon || (index > 0 && !hasSelectedQuestion);
        return (
          <button
            type="button"
            key={navItem.label}
            className={`nav-item ${activeIndex === index ? "active" : ""} ${isDisabled ? "disabled" : ""}`}
            onClick={() => { if (!isDisabled) onChange(index); }}
            disabled={isDisabled}
          >
            {navItem.label}
            {comingSoon && <span className="nav-item-badge">即將推出</span>}
          </button>
        );
      })}
    </div>
  );
}
