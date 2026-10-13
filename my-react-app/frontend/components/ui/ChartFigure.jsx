import "../../static/css/ui/chartFigure.css";

/**
 * 圖表的無障礙外框（審查項 P1-17）。
 * 圖表本身是 SVG，報讀器念不出內容、也看不到 hover 才出現的數值。這裡補三樣東西：
 *   1. role="img" 加名稱：圖表整體有一句文字描述
 *   2. 圖旁固定顯示的文字摘要（所有人都看得到，不用 hover）
 *   3. 「查看資料表」：可展開的完整數據表，鍵盤與報讀器都能逐格閱讀
 *
 * interactive: 圖裡有可操作的元素（例如可點的資料點）時設 true。role="img" 會把後代當成純圖片，
 *   吃掉按鈕語意，所以改用 role="group"。
 * columns: [{ key, label }]；rows: 物件陣列，依 columns 的 key 取值（值可先格式化成字串）。
 */
export default function ChartFigure({ title, summary, columns, rows = [], interactive = false, plotClassName = "", className = "", children }) {
  return (
    <figure className={`chart-figure ${className}`.trim()}>
      <div className={`chart-figure-plot ${plotClassName}`.trim()} role={interactive ? "group" : "img"} aria-label={title}>
        {children}
      </div>
      {rows.length > 0 && (
        <details className="chart-figure-data">
          <summary>查看資料表</summary>
          <div className="chart-figure-table-wrap" tabIndex={0} role="region" aria-label={`${title}（可捲動）`}>
            <table aria-label={`${title}資料表`}>
              <thead>
                <tr>{columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((c, ci) => (ci === 0
                      ? <th key={c.key} scope="row">{row[c.key]}</th>
                      : <td key={c.key}>{row[c.key]}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {/* figcaption 必須是 figure 的第一個或最後一個子元素 */}
      <figcaption className="chart-figure-summary">{summary}</figcaption>
    </figure>
  );
}
