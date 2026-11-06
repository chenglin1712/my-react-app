import { Link } from "react-router-dom";

// 頁尾：全寬深色，左邊品牌（原語＋標語），右邊三欄入口（學習、資源、平台），下方一行版權聲明，背後一個淡的超大「原語」浮水印。
// 連結全部對照現有路由，沒有自創項目：學習與資源的項目和導覽列一致（2026-11-06 定案的分組），
// 平台：關於我們 = 使用說明（/help）、隱私權 = /privacy、聯絡 = /contact。
const LAUNCH_YEAR = 2026;

const FOOTER_COLUMNS = [
  {
    title: "學習",
    links: [
      { to: "/search", label: "單詞查詢" },
      { to: "/translate", label: "翻譯" },
      { to: "/camera", label: "影像辨識" },
      { to: "/quiz/select", label: "測驗" },
      { to: "/game", label: "遊戲專區" },
    ],
  },
  {
    title: "資源",
    links: [
      { to: "/note", label: "寫筆記" },
      { to: "/note/share", label: "筆記分享區" },
      { to: "/favorite", label: "個人詞語庫" },
    ],
  },
  {
    title: "平台",
    links: [
      { to: "/help", label: "關於我們" },
      { to: "/privacy", label: "隱私權" },
      { to: "/contact", label: "聯絡" },
    ],
  },
];

const Footer = () => {
  const now = new Date().getFullYear();
  const years = now > LAUNCH_YEAR ? `${LAUNCH_YEAR}-${now}` : `${LAUNCH_YEAR}`;
  return (
    <footer className="yy-footer">
      <span className="yy-footer__mark" aria-hidden="true">原語</span>
      <div className="yy-footer__inner">
        <div className="yy-footer__brand">
          <p className="yy-footer__name">原語</p>
          <span className="yy-footer__dot" aria-hidden="true" />
          <small className="yy-footer__sub">讓語言回家</small>
        </div>
        <nav className="yy-footer__links" aria-label="頁尾選單">
          {FOOTER_COLUMNS.map((column) => (
            <div className="yy-footer__col" key={column.title}>
              <h2 className="yy-footer__col-title">{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.to}><Link to={link.to}>{link.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <p className="yy-footer__legal">
        <small>&copy; {years} 原語 YUAN・YU. 版權所有。</small>
      </p>
    </footer>
  );
};

export default Footer;
