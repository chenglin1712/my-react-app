import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import '../../../static/css/_search/activeFilters.css';

// 已套用的篩選條件：一條可個別移除的 chip 列（P2-3）。
// items：[{ key, label, onRemove }]。沒有任何條件時整列不出現。
// 移除一個 chip 後，焦點移到下一個 chip；全部移光時回到「進階篩選」按鈕，鍵盤使用者不會掉到頁面最上面。
// 稽核 FE3-16：手機版沒有「進階篩選」按鈕（改用抽屜的「篩選 / 排序」鈕，FilterPanel 給它同一個 id）；
// 萬一那個 id 還是找不到，退回搜尋框（fallbackSelector），焦點不會掉回 body。
const ActiveFilterChips = ({ items, onClearAll, returnFocusId = 'search-advanced-toggle', fallbackSelector = '[data-hotkey-search]' }) => {
  const groupRef = useRef(null);
  const focusIndex = useRef(null);

  useEffect(() => {
    if (focusIndex.current === null) return;
    const idx = focusIndex.current;
    focusIndex.current = null;
    const chips = groupRef.current?.querySelectorAll('.af-chip');
    if (chips?.length) chips[Math.min(idx, chips.length - 1)].focus();
    else (document.getElementById(returnFocusId) ?? document.querySelector(fallbackSelector))?.focus();
  }, [items.length, returnFocusId, fallbackSelector]);

  if (!items.length) return null;

  return (
    <div className="af-row" role="group" aria-label="已套用的篩選" ref={groupRef}>
      {items.map((item, i) => (
        <button
          type="button"
          key={item.key}
          className="af-chip"
          aria-label={`移除篩選：${item.label}`}
          onClick={() => { focusIndex.current = i; item.onRemove(); }}
        >
          {item.label}
          <X size={14} className="yy-icon" aria-hidden="true" />
        </button>
      ))}
      {items.length > 1 && onClearAll && (
        <button type="button" className="af-clear" onClick={() => { focusIndex.current = 0; onClearAll(); }}>清除全部</button>
      )}
    </div>
  );
};

export default ActiveFilterChips;
