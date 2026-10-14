// 旋轉 45 度的菱形圖示徽章，用於族語色塊、步驟/等級標記等。
// as：放進 <button> 這類只能包行內內容的元素時改傳 "span"
const DiamondBadge = ({ color = '#9E1B24', size = 44, fontSize = 15, children, style, as: Tag = 'div' }) => (
  <Tag
    className="yy-diamond-badge"
    style={{ width: size, height: size, background: color, fontSize, ...style }}
  >
    <span>{children}</span>
  </Tag>
);

export default DiamondBadge;
