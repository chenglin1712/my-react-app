import {
  ComposedChart,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import ChartFigure from "../ui/ChartFigure";
import "../../static/css/_quiz/situation_0judy_2.css";

const formatRate = (value) => (Number.isFinite(value) ? `${value}%` : "無資料");

const SituationLine = ({ data }) => {
  // 計算使用者總平均。data 是空陣列時（例如剛開始使用、還沒有月度資料）
  // 除以 data.length 會是除以 0，得到 NaN，圓餅圖跟下面顯示的數字都會壞掉。
  const validRates = data.map((item) => item.correctRate).filter(Number.isFinite);
  const userAvg = validRates.length
    ? validRates.reduce((sum, rate) => sum + rate, 0) / validRates.length
    : 0;

  const pieData = [
    { name: "平均分數", value: userAvg },
    { name: "剩餘", value: 100 - userAvg },
  ];
  const COLORS = ["#9E1B24", "#EFE1C4"];

  // 圖表的文字摘要：看不到圖、或沒有 hover 的人也拿得到重點（審查項 P1-17）
  const historySummary = validRates.length
    ? `共 ${data.length} 筆紀錄，正確率最高 ${Math.max(...validRates)}%，最低 ${Math.min(...validRates)}%，平均 ${userAvg.toFixed(1)}%。`
    : "目前還沒有歷史紀錄。";

  return (
    <div className="judy-situation-line-container">
      <h2 className="situation-header" style={{ fontWeight: "500" }}>歷史表現</h2>
      {/* 手機寬度改縱排（審查項 P1-16）：原本用 inline style 寫死左右並排，CSS 也沒有任何媒體查詢 */}
      <div className="judy-situation-line-chart-wrapper">
        {/* 組合圖 */}
        <ChartFigure
          className="judy-line-main"
          plotClassName="judy-line-plot"
          title="歷史表現"
          summary={historySummary}
          columns={[
            { key: "date", label: "日期" },
            { key: "correctRate", label: "正確率" },
            { key: "averageAccuracy", label: "同期平均" },
          ]}
          rows={data.map((item) => ({
            date: item.date,
            correctRate: formatRate(item.correctRate),
            averageAccuracy: formatRate(item.averageAccuracy),
          }))}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 20, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#22181233"
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12, fill: "#3E3226" }}
                axisLine={{ stroke: "#3E3226" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 12, fill: "#3E3226" }}
                axisLine={{ stroke: "#3E3226" }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#ffffff",
                  borderRadius: 8,
                  border: "1.5px solid #221812",
                  boxShadow: "0 10px 30px rgba(41, 45, 49, 0.18)",
                  fontSize: 13,
                }}
                labelStyle={{ color: "#221812", fontWeight: 600 }}
                cursor={{ stroke: "#221812", strokeWidth: 2 }}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 13, paddingTop: 10 }}
              />

              {/* 區域圖 - 同期平均 */}
              <Area
                type="monotone"
                dataKey="averageAccuracy"
                name="同期平均"
                fill="rgba(31, 58, 92, 0.25)"
                stroke="#1F3A5C"
                strokeWidth={2}
                strokeDasharray="5 5"
              />

              {/* 直條圖 - 正確率 */}
              <Bar
                dataKey="correctRate"
                name="正確率"
                barSize={30}
                fill="#9E1B24"
                radius={[4, 4, 0, 0]}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartFigure>

        {/* 使用者平均分數 */}
        <div className="judy-line-side">
          <div className="judy-pie-title">平均分數</div>
          <ChartFigure
            className="judy-pie-figure"
            plotClassName="judy-pie-plot"
            title="平均分數"
            summary={`平均分數 ${userAvg.toFixed(1)} 分（滿分 100）。`}
            columns={[
              { key: "name", label: "項目" },
              { key: "value", label: "數值" },
            ]}
            rows={[{ name: "平均分數", value: userAvg.toFixed(1) }]}
          >
            {/* 半徑用百分比：原本固定 70/100 像素，容器變小時圓環會被裁切 */}
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  innerRadius="68%"
                  outerRadius="92%"
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <text
                  x="50%"
                  y="50%"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontSize: "30px", fontWeight: "bold", fill: "#9E1B24" }}
                >
                  {userAvg.toFixed(1)}
                </text>
              </PieChart>
            </ResponsiveContainer>
          </ChartFigure>
        </div>
      </div>
    </div>
  );
};

export default SituationLine;
