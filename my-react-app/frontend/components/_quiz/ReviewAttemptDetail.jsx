import { CheckCircle, XCircle } from "lucide-react";
import { getReviewQuestionLabel } from "./reviewQuestionModel";

function formatDate(timestamp) {
  return timestamp?.toDate ? timestamp.toDate().toLocaleString().split(" ")[0] : "-";
}

export default function ReviewAttemptDetail({ quiz, reviewQuestions, onBack, onViewQuestion }) {
  return (
    <>
      <div className="review-quiz-header">
        <button type="button" className="back-btn" onClick={onBack}>← 返回</button>
        {/* 測驗題目本身的建立時間跟使用者實際作答的時間是兩件事，這裡要顯示
            使用者作答的那一次（answeredAt），不是題目建立時間（createdAt）。 */}
        <h3>{quiz.title} {formatDate(quiz.answeredAt)}</h3>
      </div>

      <div className="quiz-questions">
        <table className="review-table">
          <thead>
            <tr>
              <th></th>
              <th>題目</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reviewQuestions.map(({ idx, item, isCorrect }) => (
              <tr key={idx}>
                <td>
                  {idx + 1}
                  {isCorrect === true && <CheckCircle size={16} color="#388e3c" />}
                  {isCorrect === false && <XCircle size={16} color="#d32f2f" />}
                </td>
                <td>{getReviewQuestionLabel(item, idx)}</td>
                <td>
                  <button type="button" className="view-btn" onClick={() => onViewQuestion(idx)}>
                    查看題目
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
