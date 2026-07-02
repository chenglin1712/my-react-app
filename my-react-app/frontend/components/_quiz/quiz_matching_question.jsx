import { useState, useEffect } from "react";
import { Link, CircleCheck, CircleX } from "lucide-react";

// 中高級「配合題」作答元件。
// 設計上刻意跟初/中級一樣採「單題單一純量分數」(1=全對 / 2=作答有誤)，
// 這樣完全不用改動既有的 evaluateAnswers()/countScore() 比對邏輯與資料庫schema，
// 只是把「選項按鈕」換成「配對版」而已。
//
// 一旦本題已經作答過(answered=true)，切換題目再回來時就直接顯示解答總覽，
// 不會讓使用者重新配對一次（配對是一次性的遊戲式互動，答案已確定就不重玩)。
const MatchingQuestion = ({ question, answered, resultValue, onAnswer }) => {
    const [leftList, setLeftList] = useState([]);
    const [rightList, setRightList] = useState([]);
    const [selectedWord, setSelectedWord] = useState(null);
    const [matches, setMatches] = useState({});
    const [wrongPair, setWrongPair] = useState(null);
    const [isFinished, setIsFinished] = useState(false);

    useEffect(() => {
        const shuffle = (arr) => {
            const newArr = [...arr];
            for (let i = newArr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
            }
            return newArr;
        };
        setLeftList(shuffle(question.pairs.map((p) => p.cn)));
        setRightList(shuffle(question.pairs.map((p) => p.tayal)));
        setSelectedWord(null);
        setMatches({});
        setWrongPair(null);
        setIsFinished(false);
    }, [question]);

    if (answered) {
        return (
            <div className="match-board match-board-readonly">
                <h5 className="match-board-title"><Link size={18} />&nbsp;配合題（已完成）</h5>
                <p className={resultValue === 1 ? "match-result-ok" : "match-result-bad"}>
                    {resultValue === 1 ? <><CircleCheck size={18} /> 本題配對全部正確</> : <><CircleX size={18} /> 本題配對有誤</>}
                </p>
                <div className="match-answer-key">
                    {question.pairs.map((p) => (
                        <div className="match-answer-key-row" key={p.cn}>
                            <span>{p.cn}</span>
                            <span className="match-answer-arrow">→</span>
                            <span>{p.tayal.word}</span>
                        </div>
                    ))}
                </div>
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
        const tayal = isCn ? selectedWord.word : word;
        const pair = question.pairs.find((p) => p.cn === cn);
        if (!pair) { setSelectedWord(null); return; }

        if (pair.tayal.word === tayal) {
            const newMatches = { ...matches, [cn]: tayal };
            setMatches(newMatches);
            setSelectedWord(null);

            if (Object.keys(newMatches).length === question.pairs.length) {
                setIsFinished(true);
                onAnswer(1);
            }
        } else {
            setWrongPair({ cn, chosen: tayal, correct: pair.tayal.word });
            setIsFinished(true);
            onAnswer(2);
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
            <div className="match-grid">
                <div className="match-col">
                    {leftList.map((cn) => (
                        <button
                            key={cn}
                            className={getButtonClass(cn, true)}
                            onClick={() => handleSelect(cn, true)}
                            disabled={isFinished}
                        >
                            {cn}
                        </button>
                    ))}
                </div>
                <div className="match-col">
                    {rightList.map((tayal) => (
                        <button
                            key={tayal.word}
                            className={getButtonClass(tayal.word, false)}
                            onClick={() => handleSelect(tayal.word, false)}
                            disabled={isFinished}
                        >
                            {tayal.word}
                        </button>
                    ))}
                </div>
            </div>

            {wrongPair && (
                <div className="match-wrong-hint">
                    <CircleX size={18} color="#d32f2f" />
                    &nbsp;{wrongPair.cn} 的正確配對是「{wrongPair.correct}」
                </div>
            )}
        </div>
    );
};
export default MatchingQuestion;
