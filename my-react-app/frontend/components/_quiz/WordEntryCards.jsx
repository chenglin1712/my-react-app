import PropTypes from "prop-types";
import { useId } from "react";
import { Play, ExternalLink } from "lucide-react";
import { dictionaryHref } from "../../utils/dictionaryLink";

// 助手回覆旁的辭典詞條卡片（路線圖 #17）。內容全部來自辭典資料庫（後端 entries.py 只挑回覆有提到、
// 而且辭典查到的詞），所以它只表示「辭典有這個詞條」，不表示回覆的每一句話都有出處。
// playAudio / failedAudio 來自 useAuthorizedAudioPlayback，由呼叫端持有，這樣整個視窗同一時間只會有一個音檔在播。
const WordEntryCards = ({ entries, tribe, playAudio, failedAudio }) => {
    const titleId = useId();
    const valid = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.word === "string" && e.word);
    if (valid.length === 0) return null;

    return (
        <section className="entry-cards" aria-labelledby={titleId}>
            <p className="entry-cards-title" id={titleId}>本次查到的辭典詞條</p>
            <ul>
                {valid.map((entry) => {
                    const audioFailed = Boolean(entry.audio) && failedAudio?.has(entry.audio);
                    return (
                        <li key={entry.word_id || entry.word} className="entry-card">
                            <div className="entry-card-text">
                                <span className="entry-card-word">{entry.word}</span>
                                {entry.chinese && <span className="entry-card-gloss">{entry.chinese}</span>}
                            </div>
                            <div className="entry-card-actions">
                                {entry.audio && !audioFailed && (
                                    <button
                                        type="button"
                                        className="entry-card-play"
                                        aria-label={`播放「${entry.word}」的發音`}
                                        onClick={() => playAudio?.(entry.audio)}
                                    >
                                        <span className="entry-card-play-icon"><Play size={14} aria-hidden="true" /></span>
                                    </button>
                                )}
                                {audioFailed && <span className="entry-card-muted">音檔無法播放</span>}
                                <a
                                    className="entry-card-link"
                                    href={dictionaryHref(entry.word, tribe)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`在辭典查看「${entry.word}」（另開新分頁）`}
                                >
                                    辭典
                                    <ExternalLink size={12} aria-hidden="true" />
                                </a>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

WordEntryCards.propTypes = {
    entries: PropTypes.arrayOf(PropTypes.shape({
        word_id: PropTypes.string,
        word: PropTypes.string,
        chinese: PropTypes.string,
        audio: PropTypes.string,
    })),
    tribe: PropTypes.string.isRequired,
    playAudio: PropTypes.func,
    failedAudio: PropTypes.instanceOf(Set),
};

export default WordEntryCards;
