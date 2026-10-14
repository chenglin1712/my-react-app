import "../../static/css/ui/wordFilter.css";
import { FREQUENCY_LEVELS } from "../../utils/wordFilterState";

const sameFrequency = (current, level) => String(current ?? '') === String(level);

/**
 * 字詞篩選列：辭典、影像辨識、收藏（桌面版）與手機抽屜共用同一套 chip 風格（審查項 P2-20）。
 * 每個 chip 都是 aria-pressed 的切換鈕；選中時除了顏色還有勾號或加粗外框（P2-38）。
 *
 * onToggleFavorites 傳進來才會顯示「只顯示收藏」；extra 是排在第一列最後面的額外按鈕（例如影像辨識的「返回」）。
 */
export default function WordFilterControls({
  sortOrder, onSortOrderChange,
  filterLetter, onFilterLetterChange, alphabet = [],
  frequencyFilter, onFrequencyFilterChange,
  showOnlyFavorites = false, onToggleFavorites,
  extra,
  className = '',
}) {
  return (
    <div className={`wf-bar ${className}`.trim()}>
      <div className="wf-row">
        <button
          type="button"
          className="wf-chip wf-chip--text"
          onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
        >
          排序：{sortOrder === 'asc' ? 'A → Z' : 'Z → A'}
        </button>

        {onToggleFavorites && (
          <button
            type="button"
            className={`wf-chip wf-chip--text${showOnlyFavorites ? ' is-selected' : ''}`}
            aria-pressed={showOnlyFavorites}
            onClick={onToggleFavorites}
          >
            {showOnlyFavorites && <span className="wf-check" aria-hidden="true">✓&nbsp;</span>}
            只顯示收藏
          </button>
        )}

        <div className="wf-row" role="group" aria-label="詞頻">
          <span className="wf-group-label" aria-hidden="true">詞頻</span>
          {FREQUENCY_LEVELS.map((level) => {
            const selected = sameFrequency(frequencyFilter, level);
            return (
              <button
                type="button"
                key={level}
                className={`wf-chip wf-chip--freq${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onFrequencyFilterChange(selected ? '' : level)}
              >
                {selected && <span className="wf-check" aria-hidden="true">✓&nbsp;</span>}
                {level} 星
              </button>
            );
          })}
        </div>

        {extra}
      </div>

      {alphabet.length > 0 && (
        <div className="wf-letter-row" role="group" aria-label="開頭字母">
          {alphabet.map((letter) => {
            const selected = filterLetter === letter;
            return (
              <button
                type="button"
                key={letter}
                className={`wf-chip wf-chip--letter${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => onFilterLetterChange(selected ? '' : letter)}
              >
                {letter}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
