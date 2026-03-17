import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, RefreshCw, BookOpen, Check, Timer, ChartColumn } from "lucide-react";
import "../../static/css/_quiz/quiz_recommon_result.css";

function ResultSummary({ totalTime, accuracy, analysis, suggestion, onRetry, onReview }) {
  const { state } = useLocation();
  const navigate = useNavigate();

  if (!state) {
    return <p>沒有測驗結果，請重新測驗。</p>;
  }
  return (
    <div className="result-container fade-in">
      <h2 className="result-title"><ChartColumn /> 測驗結算</h2>

      {/* 成績數據卡片 */}
      <div className="result-stats">
        <div className="stat-card">
          <h3 className="fw-bolder mb-4"><Timer /> 總花費時間</h3>
          <p>{state.totalTime}</p>
        </div>
        <div className="stat-card">
          <h3 className="fw-bolder mb-4"><Check /> 答對率</h3>
          <p className={accuracy >= 80 ? "good" : accuracy >= 50 ? "average" : "bad"}>
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
        <button className="retry-btn" onClick={() => navigate("../question")}>
          <RefreshCw size={18} /> 再測一次
        </button>
        <button className="review-btn" onClick={onReview}>
          <XCircle size={18} /> 答題回顧
        </button>
      </div>
    </div>
  );
}

export default ResultSummary;
