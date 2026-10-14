import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle, RefreshCw, BookOpen, Check, Timer, ChartColumn } from "lucide-react";
import { apiGet } from "../../utils/apiClient";
import ResearchConsentCard from "./ResearchConsentCard";
import RuleFeedback from "./RuleFeedback";
import "../../static/css/_quiz/quiz_recommon_result.css";

const RULE_SUMMARY_URL = import.meta.env.VITE_API_RULE_SUMMARY_URL || "/api/v1/quiz/rule_summary";

function RecommendedQuizResult() {
  const { state } = useLocation();
  const navigate = useNavigate();
  // 後端依累積作答算出的待加強詞綴；功能沒開或讀取失敗就維持 null，頁面照常顯示其他內容。
  const [ruleSummary, setRuleSummary] = useState(null);

  useEffect(() => {
    if (!state?.tribe) return undefined;
    let cancelled = false;
    apiGet(RULE_SUMMARY_URL, { params: { tribe: state.tribe } })
      .then((data) => { if (!cancelled) setRuleSummary(data); })
      .catch(() => { if (!cancelled) setRuleSummary(null); });
    return () => { cancelled = true; };
  }, [state?.tribe]);

  if (!state) {
    return <p>沒有測驗結果，請重新測驗。</p>;
  }
  return (
    <div className="result-container fade-in">
      <h2 className="result-title"><ChartColumn /> 測驗結算</h2>

      {state.modelSaveFailed && (
        <p className="result-model-warning" role="alert">
          這次測驗的學習模型儲存失敗，下次測驗可能不會延續這次的進度。
        </p>
      )}

      {/* 成績資料卡片 */}
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

      <RuleFeedback entries={state.ruleFeedback || []} summary={ruleSummary} />
      <ResearchConsentCard />

      {/* 動作按鈕 */}
      <div className="result-actions">
        <button type="button" className="retry-btn" onClick={() => navigate("../question")}>
          <RefreshCw size={18} /> 再測一次
        </button>
        {/* 「答題回顧」尚未做出逐題回顧畫面（quiz_recommon_question 導頁時的 state 已帶
            userAnswers，但這頁沒讀取）。每次測驗結束都擺一顆「尚未開放」只會干擾
            （審查項 P3-6），先不顯示，等回顧畫面有產品決定後再加回來。 */}
      </div>
    </div>
  );
}

export default RecommendedQuizResult;
