import { TRIBES } from "../../src/constants/tribes";

// 族語羅馬字列表原本在這裡硬編碼一份，跟 src/constants/tribes.js 的 TRIBES
// 重複、順序還兜不起來（Bunun/Pangcah 兩族次序對調）；改成直接從 TRIBES 衍生，
// 兩邊資料自然保持一致。
const Footer = () => (
  <div className="yy-footer">
    <div className="yy-footer__logo">YUAN・YU ◆</div>
    <div className="yy-footer__tribes">{TRIBES.map((t) => t.roman).join(' · ')}</div>
    <div className="yy-footer__copyright">© 2026 YUAN・YU</div>
  </div>
);

export default Footer;
