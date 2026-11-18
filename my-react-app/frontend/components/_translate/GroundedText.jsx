import "../../static/css/_translate/index.css";

// 佐證檢核結果的逐詞渲染：headword/attested/derived 三層都算「有語料佐證」，
// unsupported（含模型意外夾雜的中文字/數字等非拉丁字元內容）用波浪底線 +
// 淡紅底色雙重標示（不只靠顏色，避免色盲使用者看不出差異）。punct 原樣顯示、
// 不可點選。
const STATUS_LABEL = {
    headword: "辭典詞條",
    attested: "見辭典例句",
    derived: "詞綴變化形",
    unsupported: "語料庫查無此詞",
};

// lang：族語文字的 HTML lang（ISO 639-3，由呼叫端依族群帶入，見 tribeLangCode）
// reveal：結果剛出來時讓詞一個接一個淡入（P3-1）。後端是一次回完整結果，這只是畫面上的逐詞出現，不是真的串流；
// 每個詞的延遲有上限（--gt-i 最多算到 24），再長的句子後半段一起出現，總時間不超過約 0.7 秒；減少動態時沒有動畫（見 CSS）。
const MAX_STAGGER = 24;
const GroundedText = ({ tokens = [], onTokenClick, activeIndex, lang = "und", reveal = false }) => (
    <p className={`yy-grounded-text${reveal ? " is-revealing" : ""}`} lang={lang}>
        {tokens.map((t, i) => {
            const stagger = reveal ? { "--gt-i": Math.min(i, MAX_STAGGER) } : undefined;
            if (t.status === "punct") {
                return <span key={i} className="yy-gt-punct" style={stagger}>{t.surface}</span>;
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
                    style={stagger}
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
