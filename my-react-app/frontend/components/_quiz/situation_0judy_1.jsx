import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import "../../static/css/_quiz/situation_0judy_1.css";
import { Star } from "lucide-react";

const SituationSummary = ({ summary, radarData }) => {
  const ticks = [0, 20, 40, 60, 80, 100];
  const renderRadiusTick = ({ x, y, payload }) => (
    <text x={x} y={y + 15} textAnchor="middle" className="radar-axis-tick">
      {payload.value}
    </text>
  );

  const getDifficultyLevel = (difficulty) => {
    switch (difficulty) {
      case "初級": return 1;
      case "中級": return 2;
      case "中高級": return 3;
      case "高級": return 4;
      case "優級": return 5;
      default: return 0;
    }
  };
  const difficultyLevel = getDifficultyLevel(summary.level);

  return (
    <div className="situation-summary-container">
      {/* 左邊 - 建議卡片 */}
      <div className="summary-card">
        <h2 className="summary-title">建議</h2>
        <div className="summary-item">
          <span className="label">等級：</span>
          <span className="value">{summary.level}</span>
        </div>

        <div className="summary-item">
          <span className="label">難度：</span>
          <span className="value">
            {[...Array(5)].map((_, i) => (
              <Star
                key={i}
                size={18}
                strokeWidth={2}
                fill={i < difficultyLevel ? "#F4C430" : "none"}
                color="#F4C430"
                style={{ marginRight: "4px" }}
              />
            ))}
          </span>
        </div>

        <div className="summary-item">
          <span className="label">作答速度：</span>
          <span className="value">{summary.speed}</span>
        </div>

        <div className="summary-advice">{summary.advice}</div>
      </div>

      {/* 右邊 - 雷達圖 */}
      <div className="summary-radar">
        <ResponsiveContainer width="100%" height={350}>
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
            <PolarGrid stroke="#f4c7c3" />
            <PolarAngleAxis
              dataKey="category"
              tick={{ fill: "#1f2937", fontSize: 14 }}
            />
            <PolarRadiusAxis domain={[0, 100]} ticks={ticks} tick={renderRadiusTick} axisLine={false} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#ffffff",
                borderRadius: 8,
                border: "1px solid #e5e7eb",
                fontSize: 14,
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
              }}
              labelStyle={{ color: "#1f2937", fontWeight: 600 }}
            />
            <Radar
              name="分數"
              dataKey="score"
              stroke="#9B1B30"
              fill="#9B1B30"
              fillOpacity={0.3}
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SituationSummary;