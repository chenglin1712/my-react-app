import '../../static/css/ui/charRing.css';

// 字數環（P3-4）：取代「0/300」。環只是示意進度，數字資訊由呼叫端用文字提供
// （接近上限時的「還可以輸入 N 字」與給報讀器的靜態說明），所以這裡整個 aria-hidden。
// 環的顏色只是輔助：越接近上限越強調，真正的提示是旁邊的文字。更新很頻繁（每敲一個字），所以不加動畫。
const R = 10;
const C = 2 * Math.PI * R;

const CharRing = ({ value, max, warnAt = 0.9 }) => {
  const ratio = Math.min(1, Math.max(0, value / max));
  const state = ratio >= 1 ? 'full' : ratio >= warnAt ? 'warn' : 'ok';
  return (
    <svg className={`yy-countring is-${state}`} width="26" height="26" viewBox="0 0 26 26" aria-hidden="true" focusable="false">
      <circle className="yy-countring__track" cx="13" cy="13" r={R} fill="none" strokeWidth="3" />
      <circle
        className="yy-countring__bar"
        cx="13"
        cy="13"
        r={R}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - ratio)}
        transform="rotate(-90 13 13)"
      />
    </svg>
  );
};

export default CharRing;
