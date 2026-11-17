// 族語切換膠囊：選取狀態是共用的深銅底象牙字加勾（見 theme-v2.css 的 .yy-pill.active），
// 族語識別色降飽和後只當字前面的小圓點，不做大面積色塊（P1-2）。
const TribePill = ({ tribe, active, onClick, children }) => (
  <button
    type="button"
    className={`yy-pill${active ? ' active' : ''}`}
    style={tribe.color ? { '--tribe-color': tribe.color } : undefined}
    aria-pressed={active}
    onClick={onClick}
  >
    {tribe.color && <span className="yy-pill__dot" aria-hidden="true" />}
    {children ?? `${tribe.name}族語`}
  </button>
);

export default TribePill;
