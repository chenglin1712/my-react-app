import "../../static/css/_home/promoVideo.css";

/**
 * 第一屏左欄的大標題與一句說明（雜誌版）：標題是標語，說明是固定的一句。
 * 標語空白（開關關閉）時不輸出。用 h2：頁面的 h1 是下方主視覺的標題。
 */
const HomeIntro = ({ title = "", lede = "" }) => {
    if (!title) return null;
    return (
        <div className="home-intro">
            <h2 className="home-intro__title">{title}</h2>
            {lede && <p className="home-intro__lede">{lede}</p>}
        </div>
    );
};

export default HomeIntro;
