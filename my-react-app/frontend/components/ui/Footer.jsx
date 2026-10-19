import { Link } from "react-router-dom";

// 頁尾：左邊品牌（原語＋標語），右邊三個入口，下方一行版權聲明。
// 連結文字與設計稿一致，指向現有頁面：關於我們 = 使用說明（/help），隱私權 = /privacy，聯絡 = /contact。
const LAUNCH_YEAR = 2026;

const Footer = () => {
  const now = new Date().getFullYear();
  const years = now > LAUNCH_YEAR ? `${LAUNCH_YEAR}-${now}` : `${LAUNCH_YEAR}`;
  return (
    <footer className="yy-footer">
      <div className="yy-footer__inner">
        <div className="yy-footer__brand">
          <p className="yy-footer__name">原語</p>
          <span className="yy-footer__dot" aria-hidden="true" />
          <small className="yy-footer__sub">讓語言回家</small>
        </div>
        <nav className="yy-footer__links" aria-label="頁尾選單">
          <Link to="/help">關於我們</Link>
          <Link to="/privacy">隱私權</Link>
          <Link to="/contact">聯絡</Link>
        </nav>
      </div>
      <p className="yy-footer__legal">
        <small>&copy; {years} 原語 YUAN・YU. 版權所有。</small>
      </p>
    </footer>
  );
};

export default Footer;
