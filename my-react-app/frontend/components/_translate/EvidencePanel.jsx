import { FaPlayCircle } from "react-icons/fa";
import "../../static/css/_translate/index.css";

// 「秀出依據」面板：把 GroundedText 逐詞標記的抽象狀態變成使用者能實際查證
// 的內容——點某個詞，這裡顯示它命中的辭典詞條或例句原文，而不是只丟一個
// 「有/沒有佐證」的判斷讓使用者自己相信。
const STATUS_TITLE = {
    headword: "辭典詞條",
    attested: "語料例句中出現過",
    derived: "詞綴變化形",
    unsupported: "語料庫查無佐證",
};

const EvidencePanel = ({ token, onPlayAudio }) => {
    if (!token) return null;

    return (
        <div className="yy-evidence-panel yy-fade-up">
            <div className="yy-evidence-head">
                <strong>{token.surface}</strong>
                <span className={`yy-evidence-badge yy-gt-${token.status}`}>
                    {STATUS_TITLE[token.status] || token.status}
                </span>
            </div>

            {token.status === "unsupported" && (
                <p className="yy-evidence-body">
                    這個詞在辭典與語料例句中都查無紀錄，可能是模型自行生成、不保證正確——請自行斟酌是否採用。
                </p>
            )}

            {(token.status === "headword" || token.status === "derived") && token.gloss && (
                <p className="yy-evidence-body">
                    <span className="yy-evidence-lemma">{token.lemma}</span> ＝ {token.gloss}
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
        </div>
    );
};

export default EvidencePanel;
