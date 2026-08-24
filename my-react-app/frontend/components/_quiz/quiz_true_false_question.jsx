// 初/中級「是非題」作答元件，跟 quiz_matching_question.jsx／quiz_cloze_question.jsx
// 同一種拆法：quiz_panel.jsx 原本只有這個題型跟 choice 題型的畫面直接寫死在檔案裡，
// matching／cloze 題型已經各自獨立成元件，這裡補齊剩下兩種、讓四種題型待遇一致。
const TrueFalseQuestion = ({ question, selected, onSelect }) => (
    <>
        <img src={question.image} alt="Question" className="question-image" />
        <div className="answers">
            <button type="button" aria-pressed={selected === 1} className={selected === 1 ? 'selected' : ''} onClick={() => onSelect(1)}>
                O (符合)
            </button>
            <button type="button" aria-pressed={selected === 2} className={selected === 2 ? 'selected' : ''} onClick={() => onSelect(2)}>
                X (不符合)
            </button>
        </div>
    </>
);
export default TrueFalseQuestion;
