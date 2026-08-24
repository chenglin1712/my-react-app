// 初/中級「三選一圖片題」作答元件，跟 quiz_true_false_question.jsx 同樣是從
// quiz_panel.jsx 拆出來、補齊四種題型待遇一致的其中一份。
const LABELS = ["A", "B", "C"];

const ChoiceQuestion = ({ question, selected, onSelect }) => (
    <div className="quiz-multi-images">
        {LABELS.map((label, idx) => (
            <button
                key={label}
                type="button"
                className={`quiz-image-box ${selected === idx + 1 ? "selected" : ""}`}
                aria-pressed={selected === idx + 1}
                onClick={() => onSelect(idx + 1)}
            >
                <span className="quiz-label">{label}</span>
                <img
                    src={question[`image${label}`]}
                    alt={`選項 ${label}`}
                />
            </button>
        ))}
    </div>
);
export default ChoiceQuestion;
