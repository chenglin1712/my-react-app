// 旋轉 45 度的菱形圖示徽章，用於族語色塊、步驟/等級標記等。
const DiamondBadge = ({ color = '#9E1B24', size = 44, fontSize = 15, children, style }) => (
  <div
    className="yy-diamond-badge"
    style={{ width: size, height: size, background: color, fontSize, ...style }}
  >
    <span>{children}</span>
  </div>
);

export default DiamondBadge;
