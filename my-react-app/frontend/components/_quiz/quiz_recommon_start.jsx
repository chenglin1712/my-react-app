import { PlayCircle } from "lucide-react";
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
        {/* 「收藏題庫」目前沒有資料模型與頁面可接，每次都擺一顆「尚未開放」只會干擾
            （審查項 P3-6），先不顯示，等產品定義好了再加回來。 */}
      </div>
    </div>
  );
}

export default RecommendedQuizStart;
