import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import "../../static/css/_home/notice.css";

const STORAGE_KEY = "yy-notice-dismissed";

// 通知內容的簽章：換了文字或連結就是新通知，之前關掉的人會再看到一次
// 用 JSON 串接而不是分隔字元，文字或連結裡含任何符號都不會讓兩則不同的通知產生相同簽章
const signatureOf = (notice) => JSON.stringify([notice.text, notice.link_url || ""]);

const readDismissed = () => {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
};
const writeDismissed = (value) => {
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch { /* 無痕模式等讀寫不了就只在這次瀏覽有效 */ }
};

/**
 * 首頁頂部通知條：後台（首頁顯示設定）啟用、有文字、在有效期間內才有資料。
 * 訪客可以關閉，關閉狀態記在這台裝置（localStorage），同一則通知不再出現；內容一換就再出現。
 * 連結：站內路徑用 <Link>，https 用一般 <a>（另開分頁、noopener），其他（javascript:、// 等）一律當純文字，後端驗證之外的第二道防線。文字一律以純文字渲染。
 */
const NoticeBar = ({ notice }) => {
    const [closedNow, setClosedNow] = useState(false);
    if (!notice || !notice.text || closedNow) return null;
    const signature = signatureOf(notice);
    if (readDismissed() === signature) return null;

    const link = notice.link_url || "";
    const internal = link.startsWith("/") && !link.startsWith("//");
    const close = () => { writeDismissed(signature); setClosedNow(true); };

    let body = <span className="home-notice__text">{notice.text}</span>;
    if (link && internal) body = <Link className="home-notice__text home-notice__link" to={link}>{notice.text}</Link>;
    else if (link.startsWith("https://")) body = <a className="home-notice__text home-notice__link" href={link} target="_blank" rel="noopener noreferrer">{notice.text}<span className="visually-hidden">（另開新視窗）</span></a>;

    return (
        <aside className="home-notice" aria-label="網站通知">
            {body}
            <button type="button" className="home-notice__close" aria-label="關閉通知" onClick={close}>
                <X size={18} aria-hidden="true" />
            </button>
        </aside>
    );
};

export default NoticeBar;
