import {
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer
} from 'recharts';
import ChartFigure from '../ui/ChartFigure';
import '../../static/css/_quiz/situation_0judy_3.css';

const typeMap = {
  trueFalse: { name: '是非', color: '#9E1B24' },
  multipleChoice: { name: '選擇', color: '#D9A227' },
  matching: { name: '配合', color: '#1F3A5C' },
  fillInTheBlank: { name: '閱讀填空', color: '#4B6B3A' }
};
// typeMap 這 4 個 key 是外部後端流程寫入 questionTypeDistribution 時用的彙總
// 格式，這個 repo 沒有那份程式碼，沒辦法確認未來會不會再多別的 key——保底
// 用「其他題型」呈現，不要讓沒對應到的 key 讓整頁掛掉。
// 顏色用深灰（白字對比約 6:1）；原本的淺灰 #B0B0B0 搭白色百分比文字只有 2.1:1（審查項 P2-101）
const FALLBACK_TYPE = { name: '其他題型', color: '#6B5A47' };

const getPerformance = (score) => {
  if (score >= 80) return "良好";
  if (score >= 60) return "需加強";
  return "不及格";
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="situation-tooltip-box">
        <p className="situation-tooltip-title">{`題型: ${label}`}</p>
        {payload.map((entry, index) => (
          <p key={index} className='situation-tooltip-subtitle'>
            <span className="situation-tooltip-swatch" style={{ backgroundColor: entry.color }} aria-hidden="true" />
            {`${entry.name}: ${entry.value}%`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const SituationDashboard = ({ data, typeRatio }) => {
  const performanceData = (data ?? []).map(item => ({
    ...item,
    performance: getPerformance(item.correctRate)
  }));

  // typeRatio 可能是 undefined（後端沒有回傳題型分布），Object.entries(undefined) 會丟出例外
  const questionTypeData = Object.entries(typeRatio ?? {}).map(([key, value]) => ({
    name: (typeMap[key] ?? FALLBACK_TYPE).name,
    value,
    color: (typeMap[key] ?? FALLBACK_TYPE).color
  }));

  // 圖表文字摘要：圓餅圖 5% 以下的切片不顯示百分比標籤，所以完整數字也放在摘要與圖例（審查項 P1-17）
  const typeTotal = questionTypeData.reduce((sum, item) => sum + (Number.isFinite(item.value) ? item.value : 0), 0);
  const percentOf = (value) => (typeTotal > 0 && Number.isFinite(value) ? `${((value / typeTotal) * 100).toFixed(1)}%` : "0%");
  const pieSummary = typeTotal > 0
    ? `共 ${questionTypeData.length} 種題型：${questionTypeData.map((i) => `${i.name} ${percentOf(i.value)}`).join("、")}。`
    : "目前還沒有題型資料。";
  const countByPerformance = (label) => performanceData.filter((i) => i.performance === label).length;
  const barSummary = performanceData.length
    ? `共 ${performanceData.length} 種題型，良好 ${countByPerformance("良好")} 種、需加強 ${countByPerformance("需加強")} 種、不及格 ${countByPerformance("不及格")} 種。`
    : "目前還沒有各題型的正確率。";

  const getPerformanceColor = (performance) => {
    switch (performance) {
      case '良好': return '#4B6B3A';
      case '需加強': return '#D9A227';
      case '不及格': return '#9E1B24';
      default: return '#6B7280';
    }
  };

  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
    if (percent < 0.05) return null;

    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    return (
      <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" className="pie-label">
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className="situation-dashboard-container">
      <div className="situation-header">總覽</div>

      <div className="situation-dashboard-grid">
        {/* 題型分布圓餅圖 */}
        <div className="situation-card">
          <h2 className="situation-card-title">題型分布</h2>
          <ChartFigure
            plotClassName="situation-chart-container-judy"
            title="題型分布"
            summary={pieSummary}
            columns={[{ key: "name", label: "題型" }, { key: "share", label: "比例" }]}
            rows={questionTypeData.map((i) => ({ name: i.name, share: percentOf(i.value) }))}
          >
            {questionTypeData.length === 0 ? <p className="situation-chart-empty">尚無資料</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={questionTypeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={renderCustomizedLabel}
                  outerRadius={100}
                  innerRadius={40}
                  dataKey="value"
                  stroke="#fff"
                  strokeWidth={2}
                >
                  {questionTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name) => [percentOf(value), name]} />
              </PieChart>
            </ResponsiveContainer>
            )}
          </ChartFigure>
          <div className="situation-legend-grid">
            {questionTypeData.map((item, index) => (
              <div key={index} className="situation-legend-item">
                <div className="situation-legend-color" style={{ backgroundColor: item.color }}></div>
                <span className="situation-legend-name">{item.name} {percentOf(item.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 組合圖 */}
        <div className="situation-card">
          <ChartFigure
            plotClassName="situation-chart-container-judy"
            title="各題型正確率"
            summary={barSummary}
            columns={[
              { key: "type", label: "題型" },
              { key: "correctRate", label: "正確率" },
              { key: "averageAccuracy", label: "平均正確率" },
              { key: "performance", label: "表現" },
            ]}
            rows={performanceData.map((i) => ({
              type: i.type,
              correctRate: Number.isFinite(i.correctRate) ? `${i.correctRate}%` : "無資料",
              averageAccuracy: Number.isFinite(i.averageAccuracy) ? `${i.averageAccuracy}%` : "無資料",
              performance: i.performance,
            }))}
          >
            {performanceData.length === 0 ? <p className="situation-chart-empty">尚無資料</p> : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={performanceData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#EFE1C4" />
                <XAxis dataKey="type" axisLine={{ stroke: '#221812' }} tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" axisLine={{ stroke: '#221812' }} tick={{ fontSize: 12 }} label={{ value: '正確率 (%)', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  layout="horizontal"
                  payload={[
                    { value: '平均正確率', type: 'line', color: '#221812' },
                    { value: '良好', type: 'square', color: '#4B6B3A' },
                    { value: '需加強', type: 'square', color: '#D9A227' },
                    { value: '不及格', type: 'square', color: '#9E1B24' },
                  ]}
                  iconSize={16}
                  wrapperStyle={{ display: 'flex', width: '-webkit-fill-available', justifyContent: 'center' }}
                  formatter={(value) => <span style={{ fontSize: 14, color: "#221812" }}>{value}</span>}
                />

                <Bar
                  yAxisId="left"
                  dataKey="correctRate"
                  name="正確率"
                  radius={[4, 4, 0, 0]}
                >
                  {performanceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getPerformanceColor(entry.performance)} />
                  ))}
                  <LabelList
                    dataKey="correctRate"
                    content={({ x, y, width, value, index }) => (
                      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="#221812">
                        {`${value}% ${performanceData[index]?.performance ?? ''}`}
                      </text>
                    )}
                  />
                </Bar>

                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="averageAccuracy"
                  name="平均正確率"
                  stroke="#221812"
                  strokeWidth={3}
                  dot={{ fill: 'white', strokeWidth: 2, r: 6 }}
                  activeDot={{ r: 8, stroke: '#221812', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            )}
          </ChartFigure>
        </div>
      </div>
    </div>
  );
};

export default SituationDashboard;