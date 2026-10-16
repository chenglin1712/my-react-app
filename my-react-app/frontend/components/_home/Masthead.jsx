import "../../static/css/_home/masthead.css";

/**
 * 三欄報頭：左「原語」、中引言（置中）、右英文刊名「YUAN・YU」與標語。
 * 「原語」與「YUAN・YU」是固定品牌字；引言與標語空白或關閉時不輸出，也不放示意文字。
 * 全部以純文字節點渲染。手機寬度改成第一列「原語」與刊名、第二列引言置中。
 */
const HomeMasthead = ({ quote = "", tagline = "" }) => (
    <header className={`home-mast${quote ? "" : " home-mast--no-quote"}`}>
        <p className="home-mast__name">原語</p>
        {quote && <p className="home-mast__quote">{quote}</p>}
        <div className="home-mast__en">
            <span className="home-mast__en-name">YUAN・YU</span>
            {tagline && <span className="home-mast__tagline">{tagline}</span>}
        </div>
    </header>
);

export default HomeMasthead;
