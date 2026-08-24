import { useState } from "react";
import { countScore } from "../../src/userServives/uploadDb";
import ReviewPagination from "./review_page";

const PAGE_SIZE = 5;

function getScoreClass(score) {
  return score >= 70 ? "score-good" : "score-bad";
}

function formatAnsweredAt(timestamp) {
  return timestamp?.toDate ? timestamp.toDate().toLocaleString().split(" ")[0] : "-";
}

export default function ReviewAttemptList({ situations, loading, onViewAttempt }) {
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(situations.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedSituations = situations.slice(startIndex, startIndex + PAGE_SIZE);

  return (
    <>
      <table className="review-table">
        <thead>
          <tr>
            <th>測驗時間</th>
            <th>類型</th>
            <th>分數</th>
            <th style={{ width: "124.67px" }} />
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <tr><td colSpan={4} style={{ textAlign: "center" }}>載入中...</td></tr>
          ) : situations.length === 0 ? (
            <tr><td colSpan={4} style={{ textAlign: "center" }}>尚無答題紀錄</td></tr>
          ) : (
            paginatedSituations.map((s) => {
              const score = countScore(s.results);
              return (
                // situations 的 quizId 是「這次測驗題目本身」的 id，同一份題目
                // 被作答過兩次以上就會重複，改用 situation 文件自己的 id（每次
                // 作答都是獨立一筆）當 key。
                <tr key={s.id}>
                  <td>{formatAnsweredAt(s.answeredAt)}</td>
                  <td>{s.quizType}</td>
                  <td>
                    <span className={getScoreClass(score)}>{score}</span>
                  </td>
                  <td>
                    <button type="button" className="view-btn" onClick={() => onViewAttempt(s)}>
                      查看測驗
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <ReviewPagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </>
  );
}
