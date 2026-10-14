import { useState, useEffect } from "react";
import { Link, CircleCheck, CircleX } from "lucide-react";

// 中高級「配合題」作答元件。
// 設計上刻意跟初/中級一樣採「單題單一純量分數」(1=全對 / 2=作答有誤)，
// 這樣完全不用改動既有的 evaluateAnswers()/countScore() 比對邏輯與資料庫schema，
// 只是把「選項按鈕」換成「配對版」而已。
//
// 規則：配錯一組不會結束本題，也不會顯示正確配對（考試中就揭露答案，與其他題型不一致，
// 手機誤觸一次也會整題失敗，審查項 P2-57）。全部配對完成後才計分：途中沒配錯回報 1，
// 配錯過回報 2；正確配對在交卷後的成績頁才看得到。
//
// 一旦本題已經作答過(answered=true)，切換題目再回來時只顯示結果，不會讓使用者重新配對一次，
// 也不列出解答。
// 抽到 module scope（不是每次 render/effect 都在裡面重新定義），單獨可測試。
// 配錯次數記在題目物件上（WeakMap），不放元件 state：切到別題再回來元件會重建，
// 放 state 的話「先配錯、離開再回來」就能把錯誤次數歸零換成滿分。
const mistakeCounts = new WeakMap();

function shuffle(arr) {
    const newArr = [...arr];
    for (let i = newArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
}

const MatchingQuestion = ({ question, answered, resultValue, onAnswer }) => {
    const [leftList, setLeftList] = useState([]);
    const [rightList, setRightList] = useState([]);
    const [selectedWord, setSelectedWord] = useState(null);
    const [matches, setMatches] = useState({});
    const [showMistakeHint, setShowMistakeHint] = useState(false);
    const [isFinished, setIsFinished] = useState(false);

    useEffect(() => {
        setLeftList(shuffle(question.pairs.map((p) => p.cn)));
        setRightList(shuffle(question.pairs.map((p) => p.word)));
        setSelectedWord(null);
        setMatches({});
        setShowMistakeHint(false);
        setIsFinished(false);
    }, [question]);

    if (answered) {
        return (
            <div className="match-board match-board-readonly">
                <h5 className="match-board-title"><Link size={18} />&nbsp;配合題（已完成）</h5>
                <p className={resultValue === 1 ? "match-result-ok" : "match-result-bad"}>
                    {resultValue === 1 ? <><CircleCheck size={18} /> 本題配對全部正確</> : <><CircleX size={18} /> 本題配對有誤</>}
                </p>
                <p className="match-rule">正確配對會在繳交試卷後的成績頁顯示。</p>
            </div>
        );
    }

    const handleSelect = (word, isCn) => {
        if (isFinished) return;

        if (!selectedWord) {
            setSelectedWord({ word, isCn });
            return;
        }
        if (selectedWord.isCn === isCn) {
            setSelectedWord({ word, isCn });
            return;
        }

        const cn = isCn ? word : selectedWord.word;
        const wordVal = isCn ? selectedWord.word : word;
        const pair = question.pairs.find((p) => p.cn === cn);
        if (!pair) { setSelectedWord(null); return; }

        if (pair.word.word === wordVal) {
            const newMatches = { ...matches, [cn]: wordVal };
            setMatches(newMatches);
            setSelectedWord(null);
            setShowMistakeHint(false);

            if (Object.keys(newMatches).length === question.pairs.length) {
                setIsFinished(true);
                onAnswer((mistakeCounts.get(question) ?? 0) === 0 ? 1 : 2);
            }
        } else {
            // 配錯：只取消目前的選取並提示再選一次，不揭露正解、不結束本題
            mistakeCounts.set(question, (mistakeCounts.get(question) ?? 0) + 1);
            setShowMistakeHint(true);
            setSelectedWord(null);
        }
    };

    const getButtonClass = (word, isCn) => {
        if (isCn && selectedWord?.word === word && selectedWord.isCn) return "match-btn selected";
        if (!isCn && selectedWord?.word === word && !selectedWord.isCn) return "match-btn selected";
        if (isCn && matches[word]) return "match-btn matched";
        if (!isCn && Object.values(matches).includes(word)) return "match-btn matched";
        return "match-btn";
    };

    return (
        <div className="match-board">
            <h5 className="match-board-title"><Link size={18} />&nbsp;配合題：請將左右兩側配對</h5>
            <p className="match-rule">配錯可以再選，全部配對完成後才計分；中途配錯過，本題算答錯。</p>
            <div className="match-grid">
                <div className="match-col">
                    {leftList.map((cn) => (
                        <button
                            key={cn}
                            type="button"
                            className={getButtonClass(cn, true)}
                            onClick={() => handleSelect(cn, true)}
                            disabled={isFinished}
                        >
                            {cn}
                        </button>
                    ))}
                </div>
                <div className="match-col">
                    {rightList.map((wordItem) => (
                        <button
                            key={wordItem.word}
                            type="button"
                            className={getButtonClass(wordItem.word, false)}
                            onClick={() => handleSelect(wordItem.word, false)}
                            disabled={isFinished}
                        >
                            {wordItem.word}
                        </button>
                    ))}
                </div>
            </div>

            <div role="status">
                {showMistakeHint && (
                    <div className="match-wrong-hint">
                        <CircleX size={18} style={{ color: "var(--yy-red)" }} />
                        &nbsp;這兩個不是一組，再選一次。
                    </div>
                )}
            </div>
        </div>
    );
};
export default MatchingQuestion;
