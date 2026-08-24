import { Check, Play } from "lucide-react";

// 複習頁「單一題目」卡片的題型渲染器。跟 quiz_panel_submit.jsx 的
// RESULT_RENDERERS 是同一套資料形狀（item + userAnswerNum + correctAnswerNum），
// 只是呈現成大卡片而不是表格列——原本 review.jsx 只認得「有 images 欄位」
// （選擇題）跟其他一律當是非題兩種情況，配合題／閱讀填空的作答紀錄會被誤
// 顯示成錯誤的是非題內容。

const LABELS = ["A", "B", "C", "D"];

function formatOX(num) {
  if (num === 1) return "O（符合）";
  if (num === 2) return "X（不符合）";
  return "未作答";
}

function PlayAudioButton({ audio }) {
  if (!audio) return null;
  return (
    <button
      type="button"
      className="play-btn"
      onClick={() => { new Audio(audio).play().catch(() => {}); }}
      aria-label="播放音訊"
    >
      <Play size={20} />
    </button>
  );
}

export function TrueFalseDetail({ item, userAnswerNum, correctAnswerNum }) {
  return (
    <>
      <div className="question-content">
        <PlayAudioButton audio={item.audio} />
        <div>
          <p className="question-ab">{item.question_ab}</p>
          <p className="question-ch">{item.question_ch}</p>
        </div>
      </div>
      <div className="answer-row">
        <p>你的答案：<strong>{formatOX(userAnswerNum)}</strong></p>
        <p>正確答案：<strong>{correctAnswerNum === 1 ? "O（符合）" : "X（不符合）"}</strong></p>
      </div>
    </>
  );
}

export function ChoiceDetail({ item, userAnswerNum, correctAnswerNum }) {
  const availableLabels = LABELS.filter((label) => item.images?.[label]);
  return (
    <>
      <div className="question-content">
        <PlayAudioButton audio={item.audio} />
        <div>
          <p className="question-ab">{item.question_ab}</p>
          <p className="question-ch">{item.question_ch}</p>
        </div>
      </div>
      <div className="answer-row answer-images">
        <div className="answer-block">
          <span>選項</span>
          <div className="answer-options">
            {availableLabels.map((label, i) => {
              const isUserChoice = userAnswerNum === i + 1;
              const isCorrectChoice = correctAnswerNum === i + 1;
              return (
                <div key={label}>
                  <div className={`option-img-wrapper ${isUserChoice ? "user-choice" : ""}`}>
                    <img src={item.images[label]} alt={`選項 ${label}`} className="option-img" />
                    <span className="option-label">{label}</span>
                  </div>
                  {isCorrectChoice && <span className="correct-tip"><Check size={14} /> 正確答案</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

export function MatchingDetail({ item, userAnswerNum }) {
  return (
    <>
      <div className="question-content">
        <div>
          <p className="question-ab">配合題</p>
          <p className="question-ch">
            {item.pairs?.map((p) => `${p.cn}→${p.word?.word}`).join('；')}
          </p>
        </div>
      </div>
      <div className="answer-row">
        <p>你的答案：<strong>{userAnswerNum === 1 ? "全對" : userAnswerNum === 2 ? "有錯" : "未作答"}</strong></p>
        <p>正確答案：<strong>全對</strong></p>
      </div>
    </>
  );
}

export function ClozeDetail({ item, userAnswerNum, correctAnswerNum }) {
  return (
    <>
      <div className="question-content">
        <div>
          <p className="question-ab">{item.passage_ab}</p>
          <p className="question-ch">{item.passage_ch}</p>
        </div>
      </div>
      <div className="answer-row">
        <p>你的答案：<strong>{item.options?.[userAnswerNum - 1] ?? "未作答"}</strong></p>
        <p>正確答案：<strong>{item.options?.[correctAnswerNum - 1] ?? "-"}</strong></p>
      </div>
    </>
  );
}

export const REVIEW_QUESTION_RENDERERS = {
  true_false: TrueFalseDetail,
  choice: ChoiceDetail,
  matching: MatchingDetail,
  cloze: ClozeDetail,
};
