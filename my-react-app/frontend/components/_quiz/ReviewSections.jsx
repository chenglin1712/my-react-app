import PropTypes from "prop-types";
import { dictionaryHref } from "../../utils/dictionaryLink";

// 補充說明的分欄（路線圖 #11、#22 共用）：詞彙用法、語法、文化背景、常見錯誤。
// 後端只回有內容的欄位，這裡照順序顯示有的那幾個；全都沒有就整塊不出現。
// interactive：詞彙用法的詞可連到辭典（另開分頁）。縮圖那一則整塊是 role="button"，裡面不能再放連結，所以預設關閉。
const SECTION_LABELS = [
    ["grammar", "語法"],
    ["culture", "文化背景"],
    ["pitfalls", "常見錯誤"],
];

const hasSections =(sections) =>
    Boolean(sections) && (sections.vocab?.length > 0 || SECTION_LABELS.some(([key]) => sections[key]));

const ReviewSections = ({ sections, tribe, interactive = false }) => {
    if (!hasSections(sections)) return null;
    const vocab = sections.vocab;
    return (
        <dl className="review-sections">
            {vocab?.length > 0 && (
                <div className="review-section">
                    <dt>詞彙用法</dt>
                    <dd>
                        <ul className="review-vocab">
                            {vocab.map((item, i) => (
                                <li key={i}>
                                    {interactive ? (
                                        <a
                                            className="review-vocab-word"
                                            href={dictionaryHref(item.word, tribe)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={`在辭典查看「${item.word}」（另開新分頁）`}
                                        >
                                            {item.word}
                                        </a>
                                    ) : (
                                        <strong className="review-vocab-word">{item.word}</strong>
                                    )}
                                    <span>{item.note}</span>
                                </li>
                            ))}
                        </ul>
                    </dd>
                </div>
            )}
            {SECTION_LABELS.map(([key, label]) => sections[key] && (
                <div className="review-section" key={key}>
                    <dt>{label}</dt>
                    <dd>{sections[key]}</dd>
                </div>
            ))}
        </dl>
    );
};

ReviewSections.propTypes = {
    sections: PropTypes.shape({
        vocab: PropTypes.arrayOf(PropTypes.shape({ word: PropTypes.string, note: PropTypes.string })),
        grammar: PropTypes.string,
        culture: PropTypes.string,
        pitfalls: PropTypes.string,
    }),
    tribe: PropTypes.string.isRequired,
    interactive: PropTypes.bool,
};

export default ReviewSections;
