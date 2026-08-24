import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, RefreshCw, BookOpen, Check, Timer, ChartColumn } from "lucide-react";
import "../../static/css/_quiz/quiz_recommon_result.css";

function RecommendedQuizResult() {
  const { state } = useLocation();
  const navigate = useNavigate();

  if (!state) {
    return <p>沒有測驗結果，請重新測驗。</p>;
  }
  return (
    <div className="result-container fade-in">
      <h2 className="result-title"><ChartColumn /> 測驗結算</h2>

      {state.modelSaveFailed && (
        <p role="alert" style={{ color: '#d32f2f', textAlign: 'center' }}>
          這次測驗的學習模型儲存失敗，下次測驗可能不會延續這次的進度。
        </p>
      )}

      {/* 成績數據卡片 */}
      <div className="result-stats">
        <div className="stat-card">
          <h3 className="fw-bolder mb-4"><Timer /> 總花費時間</h3>
          <p>{state.totalTime}</p>
        </div>
        <div className="stat-card">
          <h3 className="fw-bolder mb-4"><Check /> 答對率</h3>
          <p className={state.accuracy >= 80 ? "good" : state.accuracy >= 50 ? "average" : "bad"}>
            {state.accuracy}%
          </p>
        </div>
      </div>

      {/* 分析與建議 */}
      <div className="result-analysis">
        <h3 className="fw-bolder mb-4"><CheckCircle className="icon" /> 答題分析</h3>
        <p>{state.analysis}</p>
      </div>

      <div className="result-suggestion">
        <h3 className="fw-bolder mb-4"><BookOpen className="icon" /> 學習建議</h3>
        <p>{state.suggestion}</p>
      </div>

      {/* 動作按鈕 */}
      <div className="result-actions">
        <button type="button" className="retry-btn" onClick={() => navigate("../question")}>
          <RefreshCw size={18} /> 再測一次
        </button>
        {/* 「答題回顧」原本接的 onReview prop 從來沒有被傳入過，按鈕點下去
            完全沒有反應。這裡不是單純漏接一行：quiz_recommon_question.jsx
            結束測驗時，navigate("../result", ...) 帶的 state 其實已經包含
            完整的 userAnswers（每題的題目/答案/正解/作答時間），但這個結果頁
            從來沒有讀取它——暗示「逐題回顧」畫面原本有規劃、資料也接好了，
            只是 UI 從來沒有真的做出來。先 disable 並標示「尚未開放」，
            等回顧畫面該長什麼樣子有產品決定後再實作，不假裝有功能。 */}
        <button type="button" className="review-btn" disabled title="功能尚未開放">
          <XCircle size={18} /> 答題回顧（尚未開放）
        </button>
      </div>
    </div>
  );
}

export default RecommendedQuizResult;
