// 初/中級「三選一圖片題」作答元件，跟 quiz_true_false_question.jsx 同樣是從
// quiz_panel.jsx 拆出來、補齊四種題型待遇一致的其中一份。
const LABELS = ["A", "B", "C"];

const ChoiceQuestion = ({ question, selected, onSelect }) => (
    <div className="quiz-multi-images">
        {LABELS.map((label, idx) => (
            <div
                key={idx}
                className={`quiz-image-box ${selected === idx + 1 ? "selected" : ""}`}
                onClick={() => onSelect(idx + 1)}
            >
                <span className="quiz-label">{label}</span>
                <img
                    src={question[`image${label}`]}
                    alt={`選項 ${label}`}
                />
            </div>
        ))}
    </div>
);
export default ChoiceQuestion;
