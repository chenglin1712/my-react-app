// 旋轉 45 度的菱形圖示徽章，用於族語色塊、步驟/等級標記等。
// as：放進 <button> 這類只能包行內內容的元素時改傳 "span"
// color 以 CSS 變數 --yy-diamond-color 帶給 ::before（旋轉的背景層），文字層不旋轉。
// textColor：放在菱形上的文字色，淺色底（如排灣金）要傳墨色，預設白字。
const DiamondBadge = ({ color = 'var(--yy-red)', textColor, size = 44, fontSize = 15, children, style, as: Tag = 'div' }) => (
  <Tag
    className="yy-diamond-badge"
    style={{ '--yy-diamond-color': color, ...(textColor ? { '--yy-diamond-text': textColor } : null), width: size, height: size, fontSize, ...style }}
  >
    <span>{children}</span>
  </Tag>
);

export default DiamondBadge;
