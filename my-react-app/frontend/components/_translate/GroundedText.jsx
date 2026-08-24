import "../../static/css/_translate/index.css";

// 佐證檢核結果的逐詞渲染：headword/attested/derived 三層都算「有語料佐證」，
// unsupported（含模型意外夾雜的中文字/數字等非拉丁字元內容）用波浪底線 +
// 淡紅底色雙重標示（不只靠顏色，避免色盲使用者看不出差異）。punct 原樣顯示、
// 不可點擊。
const STATUS_LABEL = {
    headword: "辭典詞條",
    attested: "見辭典例句",
    derived: "詞綴變化形",
    unsupported: "語料庫查無此詞",
};

const GroundedText = ({ tokens = [], onTokenClick, activeIndex }) => (
    <p className="yy-grounded-text" lang="und">
        {tokens.map((t, i) => {
            if (t.status === "punct") {
                return <span key={i} className="yy-gt-punct">{t.surface}</span>;
            }
            // 任何非標點的 token 都可以點開 EvidencePanel 查看細節（有佐證的看
            // 是哪個詞條/例句，無佐證的也能看到「查無佐證」的明確說明）。
            return (
                <span
                    key={i}
                    className={`yy-gt-token yy-gt-${t.status}${activeIndex === i ? " yy-gt-active" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={activeIndex === i}
                    aria-label={t.status === "unsupported" ? `${t.surface}：${STATUS_LABEL.unsupported}` : undefined}
                    title={t.gloss || STATUS_LABEL[t.status] || undefined}
                    onClick={() => onTokenClick?.(i)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTokenClick?.(i); } }}
                >
                    {t.surface}
                </span>
            );
        })}
    </p>
);

export default GroundedText;
