// 族語切換膠囊：選中時背景變族語識別色 + 放大 1.05-1.06 倍（YUAN・YU v2 設計系統）。
const TribePill = ({ tribe, active, onClick, children }) => (
  <button
    type="button"
    className={`yy-pill${active ? ' active' : ''}`}
    style={active ? { background: tribe.color } : undefined}
    aria-pressed={active}
    onClick={onClick}
  >
    {children ?? `${tribe.name}族語`}
  </button>
);

export default TribePill;
