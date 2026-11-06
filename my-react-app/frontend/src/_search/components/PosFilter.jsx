// 詞類篩選（Apple 化步驟 4-2）：分段按鈕，只篩關鍵字查詢的結果。
// 選項取自目前結果實際出現的詞性（不寫死清單），最多顯示 MAX_OPTIONS 個，其餘併在「全部」之外不列。
// 每個按鈕用 aria-pressed 表示是否選取，選取的按鈕另有勾號，不只靠顏色。
export const MAX_POS_OPTIONS = 6;

const PosFilter = ({ options, value, onChange }) => {
  if (!options || options.length < 2) return null;
  const shown = options.slice(0, MAX_POS_OPTIONS);
  return (
    <div className="pos-filter" role="group" aria-label="依詞類篩選">
      <button type="button" className="pos-filter-btn" aria-pressed={!value} onClick={() => onChange('')}>全部</button>
      {shown.map(({ pos, count }) => (
        <button key={pos} type="button" className="pos-filter-btn" aria-pressed={value === pos} onClick={() => onChange(pos)}>
          {pos}<span className="pos-filter-count">{count}</span>
        </button>
      ))}
    </div>
  );
};

export default PosFilter;
