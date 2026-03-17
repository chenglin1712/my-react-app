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
  ResponsiveContainer
} from 'recharts';
import '../../static/css/_quiz/situation_0judy_3.css';

const typeMap = {
  trueFalse: { name: '是非', color: '#F4C7C3' },
  multipleChoice: { name: '選擇', color: '#E78A8C' },
  matching: { name: '配合', color: '#C0394B' },
  fillInTheBlank: { name: '閱讀填空', color: '#9B1B30' }
};

const getPerformance = (score) => {
  if (score >= 80) return "良好";
  if (score >= 60) return "需加強";
  return "不及格";
};

const SituationDashboard = ({ data, typeRatio }) => {
  const performanceData = data.map(item => ({
    ...item,
    performance: getPerformance(item.correctRate)
  }));

  const questionTypeData = Object.entries(typeRatio).map(([key, value]) => ({
    name: typeMap[key].name,
    value,
    color: typeMap[key].color
  }));

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="situation-tooltip-box">
          <p className="situation-tooltip-title">{`題型: ${label}`}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className='situation-tooltip-subtitle'>
              {`${entry.name}: ${entry.value}%`}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  const getPerformanceColor = (performance) => {
    switch (performance) {
      case '良好': return 'rgb(40, 167, 69)';
      case '需加強': return '#FFB020';
      case '不及格': return 'rgb(220, 53, 69)';
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
          <div className="situation-chart-container-judy">
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
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="situation-legend-grid">
            {questionTypeData.map((item, index) => (
              <div key={index} className="situation-legend-item">
                <div className="situation-legend-color" style={{ backgroundColor: item.color }}></div>
                <span className="situation-legend-name">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 組合圖 */}
        <div className="situation-card">
          <div className="situation-chart-container-judy" style={{ height: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={performanceData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="type" axisLine={{ stroke: '#e5e7eb' }} tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" axisLine={{ stroke: '#e5e7eb' }} tick={{ fontSize: 12 }} label={{ value: '正確率 (%)', angle: -90, position: 'insideLeft' }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  layout="horizontal"
                  payload={[
                    { value: '平均正確率', type: 'line', color: '#333' },
                    { value: '良好', type: 'square', color: '#10B981' },
                    { value: '需加強', type: 'square', color: '#F59E0B' },
                    { value: '不及格', type: 'square', color: '#EF4444' },
                  ]}
                  iconSize={16}
                  wrapperStyle={{ display: 'flex', width: '-webkit-fill-available', justifyContent: 'center' }}
                  formatter={(value) => <span style={{ fontSize: 14, color: "#333" }}>{value}</span>}
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
                </Bar>

                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="averageAccuracy"
                  name="平均正確率"
                  stroke="#333"
                  strokeWidth={3}
                  dot={{ fill: 'white', strokeWidth: 2, r: 6 }}
                  activeDot={{ r: 8, stroke: '#333', strokeWidth: 2 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SituationDashboard;