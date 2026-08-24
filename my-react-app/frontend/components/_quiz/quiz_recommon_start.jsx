import { PlayCircle, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_quiz/quiz_recommon_start.css";

function RecommendedQuizStart() {
    const navigate = useNavigate();
    const onStart = () => {
        navigate("question");
    };

  return (
    <div className="start-container">
      <h1 className="start-title">測驗系統</h1>
      <p className="start-subtitle">準備好挑戰自己了嗎？選擇一個開始方式：</p>

      <div className="start-actions">
        <button type="button" className="start-btn primary" onClick={onStart}>
          <PlayCircle size={20} /> 開始測驗
        </button>
        {/* 「收藏題庫」原本接的 onFavorite prop 從來沒有被 route.jsx 傳入過
            （<Route index element={<Comp_quiz_recommon_start />} />
            沒有帶任何 prop），按鈕點下去完全沒有反應。目前沒有薦讀題庫收藏的
            資料模型或既有頁面可以推斷這顆按鈕該做什麼，先 disable 並標示
            「尚未開放」，不假裝有功能，等產品定義好了再實作。 */}
        <button type="button" className="start-btn secondary" disabled title="功能尚未開放">
          <Star size={20} /> 收藏題庫（尚未開放）
        </button>
      </div>
    </div>
  );
}

export default RecommendedQuizStart;
