import { FaPlayCircle } from "react-icons/fa";
import "../../static/css/_morphology/index.css";

// 每個分析結果都明確標示「來源與信心」，不把低信心的結果包裝成事實：
//   辭典標註：辭典本身記錄了這個詞形的詞根（最可靠）
//   高信心：辭典歸納出的詞綴規則，且該規則通過獨立測試校準
//   中信心：辭典歸納出的詞綴規則，但沒通過校準，只供參考
//   拼寫相近：不是形態分析，只是相差一個字母的詞（實測第一名只有約 16~25% 是對的）
const CONFIDENCE = {
    dictionary: { label: "辭典標註", hint: "辭典本身標註了這個詞形的詞根。" },
    high: { label: "高信心", hint: "由辭典歸納出的詞綴規則推得，且這條規則通過了獨立測試的校準。" },
    medium: { label: "中信心・僅供參考", hint: "由辭典歸納出的詞綴規則推得，但這條規則沒有通過校準，準確度因族語與規則而異。" },
    low: { label: "拼寫相近・低信心", hint: "不是詞綴分析，只是拼寫相差一個字母的詞，常常不是你要找的。" },
};

const TOKEN_STATUS = {
    headword: "辭典詞條",
    attested: "辭典例句中出現過",
    unknown: "辭典查無此詞形",
};

const SEGMENT_TITLE = { root: "詞根", affix: "詞綴", redup: "重疊" };

const SegmentRow = ({ segments }) => (
    <span className="yy-morph-segments" aria-label={segments.map((s) => `${SEGMENT_TITLE[s.kind]}${s.text}`).join("，")}>
        {segments.map((s, i) => (
            <span key={i} className={`yy-morph-seg yy-morph-seg-${s.kind}`} title={SEGMENT_TITLE[s.kind]}>
                {s.text}
            </span>
        ))}
    </span>
);

const AudioButton = ({ fileId, label, onPlayAudio }) =>
    fileId && onPlayAudio ? (
        <button type="button" className="yy-morph-audio-btn" aria-label={label} onClick={() => onPlayAudio(fileId)}>
            <FaPlayCircle />
        </button>
    ) : null;

const Examples = ({ examples, onPlayAudio }) =>
    examples?.length > 0 ? (
        <ul className="yy-morph-examples">
            {examples.map((ex, i) => (
                <li key={i}>
                    <span lang="und" className="yy-morph-example-original">{ex.original}</span>
                    <AudioButton fileId={ex.audioFileId} label="播放例句發音" onPlayAudio={onPlayAudio} />
                    <span className="yy-morph-example-chinese">{ex.chinese}</span>
                </li>
            ))}
        </ul>
    ) : null;

const Candidate = ({ candidate: c, onPlayAudio }) => {
    const conf = CONFIDENCE[c.confidence] ?? CONFIDENCE.low;
    return (
        <li className={`yy-morph-candidate yy-morph-conf-${c.confidence}`}>
            <div className="yy-morph-candidate-head">
                <span className={`yy-morph-badge yy-morph-badge-${c.confidence}`} title={conf.hint}>{conf.label}</span>
                {c.source === "similar" ? (
                    <span>
                        你是不是想找 <strong lang="und">{c.root}</strong>
                        <span className="yy-morph-muted">（相差 {c.distance} 個字母）</span>
                    </span>
                ) : (
                    <span>
                        詞根 <strong lang="und">{c.root}</strong>
                    </span>
                )}
                <AudioButton fileId={c.audioFileId} label={`播放 ${c.root} 的發音`} onPlayAudio={onPlayAudio} />
            </div>

            {/* 拼寫相近只是編輯距離，不是形態分析，永遠不顯示切分——即使後端意外給了也不顯示。 */}
            {c.source !== "similar" && c.segments?.length > 0 && <SegmentRow segments={c.segments} />}

            {c.gloss && <p className="yy-morph-line"><span className="yy-morph-muted">詞根釋義：</span>{c.gloss}</p>}

            {c.source !== "similar" && c.rule && (
                <p className="yy-morph-line">
                    <span className="yy-morph-muted">詞綴：</span>
                    <code>{c.rule.marker}</code>
                    {c.rule.function
                        ? <span className="yy-morph-rule-function">{c.rule.function}</span>
                        : <span className="yy-morph-muted yy-morph-rule-function">（辭典沒有這條詞綴的功能說明）</span>}
                </p>
            )}

            <Examples examples={c.examples} onPlayAudio={onPlayAudio} />
        </li>
    );
};

/**
 * 詞形分析結果的顯示（純顯示，不負責取資料）。
 * result 是 POST /api/v1/morphology/analyze 的回應；compact 用在空間比較小的地方（例如翻譯的依據面板）。
 */
const MorphologyResult = ({ result, onPlayAudio, compact = false }) => {
    if (!result) return null;
    const { token, candidates = [], notes = [] } = result;

    return (
        <div className={`yy-morph-result${compact ? " yy-morph-compact" : ""}`} aria-live="polite">
            <div className="yy-morph-token">
                <strong lang="und">{result.input}</strong>
                <span className={`yy-morph-status yy-morph-status-${token.status}`}>{TOKEN_STATUS[token.status]}</span>
                {token.status === "headword" && token.gloss && (
                    <span className="yy-morph-token-gloss">＝ {token.gloss}</span>
                )}
                <AudioButton fileId={token.audioFileId} label={`播放 ${result.input} 的發音`} onPlayAudio={onPlayAudio} />
            </div>

            {token.attestedSentence && (
                <div className="yy-morph-attested">
                    <span className="yy-morph-muted">出現在這個辭典例句：</span>
                    <Examples examples={[token.attestedSentence]} onPlayAudio={onPlayAudio} />
                </div>
            )}

            {candidates.length > 0 && (
                <ul className="yy-morph-candidates">
                    {candidates.map((c, i) => <Candidate key={`${c.source}-${c.root}-${i}`} candidate={c} onPlayAudio={onPlayAudio} />)}
                </ul>
            )}

            {notes.map((n, i) => <p key={i} className="yy-morph-note">{n}</p>)}

            <p className="yy-morph-disclaimer">
                分析只說明這個詞形「可能怎麼構成」，不代表它在族語裡真的存在或被使用。
            </p>
        </div>
    );
};

export default MorphologyResult;
