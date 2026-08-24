import { CheckCircle, XCircle } from "lucide-react";
import { REVIEW_QUESTION_RENDERERS } from "./reviewQuestionRenderers";

export default function ReviewQuestionDetail({ questionType, question, onClose }) {
  if (!question) {
    return (
      <div className="review-q">
        <div className="review-empty-container">尚未選擇題目</div>
      </div>
    );
  }

  const Renderer = REVIEW_QUESTION_RENDERERS[questionType];

  return (
    <>
      <div className="review-q">
        <div className="review-question-card">
          <div className="review-question-header">
            <h4>題目{question.idx + 1}</h4>
            {question.isCorrect === true ? (
              <CheckCircle className="icon-correct" size={26} />
            ) : question.isCorrect === false ? (
              <XCircle className="icon-wrong" size={26} />
            ) : null}
          </div>

          <hr className="review-divider" />

          <div className="review-question-body">
            {Renderer ? (
              <Renderer
                item={question.item}
                userAnswerNum={question.userAnswerNum}
                correctAnswerNum={question.correctAnswerNum}
              />
            ) : (
              <p>此題型的複習畫面暫不支援，請返回測驗紀錄重新選擇。</p>
            )}
          </div>
        </div>
      </div>
      <button type="button" className="review-q-btn" onClick={onClose}>取消</button>
    </>
  );
}
