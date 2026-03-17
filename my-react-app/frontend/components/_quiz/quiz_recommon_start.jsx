import React from "react";
import { PlayCircle, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_quiz/quiz_recommon_start.css";


function QuizStart({onFavorite }) {
    const navigate = useNavigate();
     const onStart = () => {
         navigate("question");
     }

  return (
    <div className="start-container">
      <h1 className="start-title">測驗系統</h1>
      <p className="start-subtitle">準備好挑戰自己了嗎？選擇一個開始方式：</p>

      <div className="start-actions">
        <button className="start-btn primary" onClick={onStart}>
          <PlayCircle size={20} /> 開始測驗
        </button>
        <button className="start-btn secondary" onClick={onFavorite}>
          <Star size={20} /> 收藏題庫
        </button>
      </div>
    </div>
  );
}

export default QuizStart;
