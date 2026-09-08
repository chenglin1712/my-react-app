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
import "../../static/css/_quiz/situation_0judy_2.css";

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

  return (
    <div className="judy-situation-line-container">
      <h2 className="situation-header" style={{ fontWeight: "500" }}>歷史表現</h2>
      <div
        className="judy-situation-line-chart-wrapper"
        style={{ display: "flex", gap: "20px" }}
      >
        {/* 左邊 - 組合圖 */}
        <div style={{ flex: 2, height: 400 }}>
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
                  border: "2px solid #221812",
                  boxShadow: "3px 3px 0 #221812",
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
        </div>

        {/* 右邊 - 使用者平均分數 */}
        <div
          style={{
            flex: 1,
            height: 400,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: "#221812" }}>
            平均分數
          </div>
          <ResponsiveContainer width="70%" height="60%">
            <PieChart>
              <Pie
                data={pieData}
                innerRadius={70}
                outerRadius={100}
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
        </div>
      </div>
    </div>
  );
};

export default SituationLine;
