import { BookOpen } from "lucide-react";

// 高級「閱讀填空」作答元件：顯示短文（含一個空格）與中譯，
// 使用者從4個文字選項中選出最適合填入空格的詞彙。
// 資料格式與既有「選擇題」(choice) 一致：answer 為 1~4 的純量索引，
// 沿用同一套 evaluateAnswers()/countScore() 比對邏輯。
const ClozeQuestion = ({ question, selected, onSelect }) => {
    const labels = ["A", "B", "C", "D"];
    const [before, after] = question.passage_ab.split("＿＿＿");

    return (
        <div className="cloze-board">
            <h5 className="cloze-board-title"><BookOpen size={18} />&nbsp;閱讀填空</h5>
            <p className="cloze-passage">
                {before}
                <span className="cloze-blank">＿＿＿</span>
                {after}
            </p>
            <p className="cloze-passage-ch">{question.passage_ch}</p>

            <div className="cloze-options">
                {question.options.map((option, idx) => (
                    <button
                        key={idx}
                        type="button"
                        aria-pressed={selected === idx + 1}
                        className={`cloze-option-btn ${selected === idx + 1 ? "selected" : ""}`}
                        onClick={() => onSelect(idx + 1)}
                    >
                        <span className="cloze-option-label">{labels[idx]}</span>
                        {option}
                    </button>
                ))}
            </div>
        </div>
    );
};
export default ClozeQuestion;
