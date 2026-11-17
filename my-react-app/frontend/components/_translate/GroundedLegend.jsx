import "../../static/css/_translate/index.css";

// 逐詞佐證的圖例（P3-3）：每一種狀態都是「示範字樣加文字說明」，字樣用和結果同一組樣式
// （實線底線、點狀底線、波浪底線加底色），所以看得懂狀態不靠顏色。
// 最後一句是整句翻譯的提醒：有佐證只代表這個詞查得到，不代表整句翻譯一定正確。
const ITEMS = [
    { status: "headword", label: "辭典詞條" },
    { status: "attested", label: "見辭典例句（實線底線）" },
    { status: "derived", label: "詞綴變化形（點狀底線）" },
    { status: "unsupported", label: "查無佐證（波浪底線）" },
];

const GroundedLegend = () => (
    <div className="yy-gt-legend">
        <ul className="yy-gt-legend-list" aria-label="逐詞標示圖例">
            {ITEMS.map((it) => (
                <li key={it.status}>
                    <span className={`yy-gt-legend-mark yy-gt-${it.status}`} aria-hidden="true">ab</span>
                    <span>{it.label}</span>
                </li>
            ))}
        </ul>
        <p className="yy-gt-legend-note">有佐證只代表這個詞在資料庫裡查得到，不代表整句翻譯一定正確。點任何一個詞可以看依據。</p>
    </div>
);

export default GroundedLegend;
