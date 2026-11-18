import { Puzzle } from "lucide-react";
import ChartFigure from "../ui/ChartFigure";
import { describeDiagnosis, parseRuleId, roundedPercent, ruleLabel } from "./ruleSkillView";

/**
 * 測驗結束頁的「詞綴診斷」：
 * - entries：這次測驗每題的診斷（來自作答 API 的回應），只列出說得出原因的錯誤；
 * - summary：後端依整體作答累積算出的待加強規則與常見混淆（GET rule_summary），
 *   旗標關閉或資料不足時 available 為 false，這一段就不顯示。
 * 這些都是依作答次數算出的「估計」，次數少的時候誤差很大，頁面上要明講。
 */
// 路由 state 與 API 回應都是信任邊界：形狀或欄位型別不對就當作沒有，不讓結果頁因此掛掉（物件不能直接當 React child）。
const rows = (value) => (Array.isArray(value) ? value.filter((row) => row && typeof row === 'object') : []);
const text = (value, max = 80) => (typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null);
const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), 1e6) : null);
const weakRows = (value) => rows(value)
  .map((row) => ({ key: text(row.rule, 200), label: text(row.label) ?? ruleLabel(text(row.rule, 200) ?? ''), n: count(row.n), c: count(row.c), p: row.p }))
  .filter((row) => row.key && row.n !== null && row.c !== null && Number.isFinite(row.p));
const confusionRows = (value) => rows(value)
  .map((row) => ({
    key: `${text(row.target, 200)}>${text(row.selected, 200)}`,
    target: text(row.targetLabel) ?? (text(row.target, 200) && ruleLabel(row.target)),
    selected: text(row.selectedLabel) ?? (text(row.selected, 200) && ruleLabel(row.selected)),
    count: count(row.count),
  }))
  .filter((row) => row.target && row.selected && row.count !== null);

export default function RuleFeedback({ entries = [], summary = null, onPractice = null }) {
  const lines = rows(entries)
    .map((entry, index) => ({ key: index, text: describeDiagnosis(entry.diagnosis) }))
    .filter((line) => line.text);
  const showSummary = summary?.available === true;
  const weakest = showSummary ? weakRows(summary.weakest) : [];
  const confusions = showSummary ? confusionRows(summary.confusions) : [];
  const minObservations = Number.isFinite(summary?.minObservations) ? summary.minObservations : null;

  if (lines.length === 0 && !showSummary) return null;

  return (
    <div className="result-rules" data-testid="rule-feedback">
      <h3 className="fw-bolder mb-3"><Puzzle className="icon" /> 詞綴診斷</h3>

      {lines.length > 0 && (
        <>
          <p className="fw-bold mb-1">這次測驗</p>
          <ul className="result-rule-list">
            {lines.map((line) => <li key={line.key}>{line.text}</li>)}
          </ul>
        </>
      )}

      {showSummary && (
        <>
          <p className="fw-bold mb-1">你的詞綴熟練度（估計）</p>
          {weakest.length > 0 ? (
            <ChartFigure
              className="rule-chart"
              interactive
              title="詞綴熟練度（估計）條形圖"
              summary={`熟練度由低到高：${weakest.map((row) => `${row.label} ${roundedPercent(row.p)}%`).join("、")}。長條越短表示越需要加強。`}
              columns={[
                { key: "label", label: "詞綴" },
                { key: "pct", label: "熟練度（估計）" },
                { key: "n", label: "作答次數" },
                { key: "c", label: "答對次數" },
              ]}
              rows={weakest.map((row) => ({ label: row.label, pct: `${roundedPercent(row.p)}%`, n: row.n, c: row.c }))}
            >
              <ul className="rule-bars">
                {weakest.map((row) => {
                  const pct = roundedPercent(row.p);
                  return (
                    <li key={row.key} className="rule-bar-row">
                      <strong className="rule-bar-label">{row.label}</strong>
                      {/* 長條只是視覺；數字（熟練度與作答次數）直接寫在格子裡，不靠長度或顏色單獨傳達 */}
                      <span className="rule-bar-track" aria-hidden="true"><span className="rule-bar-fill" style={{ "--rule-pct": `${pct}%` }} /></span>
                      <span className="rule-bar-num">{pct}%<small>（答 {row.n} 次、對 {row.c} 次）</small></span>
                      {onPractice && parseRuleId(row.key) && (
                        <button type="button" className="rule-practice-btn" aria-label={`練這條：${row.label}`} onClick={() => onPractice(row.key)}>
                          練這條
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </ChartFigure>
          ) : (
            <p className="result-rule-note">
              目前沒有明顯待加強的詞綴。每條詞綴要累積{minObservations === null ? "足夠" : `至少 ${minObservations} 次`}作答，才會列出熟練度估計。
            </p>
          )}
          {confusions.length > 0 && (
            <>
              <p className="fw-bold mb-1 mt-2">常搞混的詞綴</p>
              <ul className="result-rule-list">
                {confusions.map((row) => (
                  <li key={row.key}>
                    該用 <strong>{row.target}</strong> 時選了 <strong>{row.selected}</strong>（{row.count} 次）
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {onPractice && weakest.length > 0 && (
        <p className="result-rule-note">按「練這條」會開始新的測驗，並優先安排這條詞綴的句子填空題；其他題型照原本出題。</p>
      )}
      <p className="result-rule-note">
        這是依你的作答次數算出的估計，不是正式評量；作答次數少的時候誤差會很大。
      </p>
    </div>
  );
}
