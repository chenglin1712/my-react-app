import { Link } from "react-router-dom";

// 頁尾對齊首頁設計稿：超大「原語」、三個細框連結、一句標語。
// 連結文字與設計稿一致，指向現有頁面：關於我們 = 使用說明（/help），隱私權 = /privacy，聯絡 = /contact。
const Footer = () => (
  <footer className="yy-footer">
    <div className="yy-footer__inner">
      <p className="yy-footer__name">原語</p>
      <nav className="yy-footer__links" aria-label="頁尾選單">
        <Link to="/help">關於我們</Link>
        <Link to="/privacy">隱私權</Link>
        <Link to="/contact">聯絡</Link>
      </nav>
      <small className="yy-footer__sub">讓語言回家</small>
    </div>
  </footer>
);

export default Footer;
