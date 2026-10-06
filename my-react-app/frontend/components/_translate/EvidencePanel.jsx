import { useEffect } from "react";
import { FaPlayCircle } from "react-icons/fa";
import { useMorphologyAnalysis } from "../../hooks/useMorphologyAnalysis";
import MorphologyResult from "../_morphology/MorphologyResult";
import "../../static/css/_translate/index.css";
import "../../static/css/_morphology/index.css";

// 「秀出依據」面板：把 GroundedText 逐詞標記的抽象狀態變成使用者能實際查證
// 的內容——點某個詞，這裡顯示它命中的辭典詞條或例句原文，而不是只丟一個
// 「有/沒有佐證」的判斷讓使用者自己相信。
const STATUS_TITLE = {
    headword: "辭典詞條",
    attested: "語料例句中出現過",
    derived: "詞綴變化形",
    unsupported: "語料庫查無佐證",
};

const EvidencePanel = ({ token, onPlayAudio, tribeSlug }) => {
    // 詞形分析是使用者主動按下去才查（不是每點一個詞就多打一次 API）；換一個詞就清掉上一個的結果。
    const morphology = useMorphologyAnalysis();
    const { reset: resetMorphology } = morphology;
    useEffect(() => {
        resetMorphology();
    }, [token?.surface, tribeSlug, resetMorphology]);

    if (!token) return null;

    return (
        <div className="yy-evidence-panel yy-fade-up">
            <div className="yy-evidence-head">
                <strong>{token.surface}</strong>
                <span className={`yy-evidence-badge yy-gt-${token.status}`}>
                    {STATUS_TITLE[token.status] || "其他佐證狀態"}
                </span>
            </div>

            {token.status === "unsupported" && (
                <p className="yy-evidence-body">
                    這個詞在辭典與語料例句中都查無紀錄，可能是模型自行生成、不保證正確——請自行斟酌是否採用。
                </p>
            )}

            {(token.status === "headword" || token.status === "derived") && token.gloss && (
                <p className="yy-evidence-body">
                    <span className="yy-evidence-lemma">{token.lemma || token.surface}</span> ＝ {token.gloss}
                    {token.audioFileId && (
                        <button
                            type="button"
                            className="yy-evidence-audio-btn"
                            aria-label={`播放 ${token.lemma} 的發音`}
                            onClick={() => onPlayAudio?.(token.audioFileId)}
                        >
                            <FaPlayCircle />
                        </button>
                    )}
                </p>
            )}

            {token.status === "derived" && token.note && (
                <p className="yy-evidence-note">詞綴分析：{token.note}</p>
            )}

            {token.status === "attested" && (
                <p className="yy-evidence-body">
                    這個詞形本身沒有獨立字典詞條，但在真實語料例句中確實出現過（見下方例句），可視為合理的變化形。
                </p>
            )}

            {tribeSlug && !morphology.result && (
                <button
                    type="button"
                    className="yy-morph-inline-btn"
                    disabled={morphology.loading}
                    onClick={() => morphology.analyze(tribeSlug, token.surface)}
                >
                    {morphology.loading ? "分析中…" : "詞形分析：看詞根與詞綴"}
                </button>
            )}
            {morphology.error && <p className="yy-morph-error" role="alert">{morphology.error}</p>}
            <MorphologyResult result={morphology.result} onPlayAudio={onPlayAudio} compact />
        </div>
    );
};

export default EvidencePanel;
