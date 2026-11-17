import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import '../../static/css/ui/tribeSegmented.css';

// 族語分段控制（P3-2）：取代一排獨立的膠囊。
// - 每一格等寬，所以選取指示塊的位置與寬度都可以只靠 transform: translateX 算出來（不動 width/left，Emil 準則）。
// - 選取狀態不只靠顏色：深銅底象牙字加勾（Check 圖示），報讀器讀的是 radio 的 aria-checked。
// - radiogroup 語意：同一時間只有一格在 Tab 順序裡（roving tabindex），← → ↑ ↓ 換族語並把焦點跟過去（方向鍵同時選取，
//   是 WAI-ARIA radiogroup 的標準做法），Home／End 跳頭尾。下一格從「目前聚焦的那格」算，連按不會因為父層還沒更新而漏格。
// - 手機放不下時外層可橫向捲動；選到的那格不在畫面內時，只捲這個容器（不捲整頁）。
// - 指示塊的彈簧會過衝，所以放在裁切層裡，過衝不會撐出橫向捲動範圍。
// - 減少動態：指示塊直接跳過去（見 tribeSegmented.css）。
// items：[{ value, label, color? }]；color 只用在字前面的小圓點（降飽和，不做大面積色塊）。
const TribeSegmented = ({ items, value, onChange, label = '選擇族語', className = '' }) => {
  const scrollerRef = useRef(null);
  const buttonRefs = useRef([]);
  const found = items.findIndex((it) => it.value === value);

  // 選到的那格不在可見範圍內（手機橫向捲動、初始值在後面）時，把它帶進來。只動這個容器，不動頁面
  useEffect(() => {
    const scroller = scrollerRef.current;
    const el = found >= 0 ? buttonRefs.current[found] : null;
    if (!scroller || !el) return;
    const box = scroller.getBoundingClientRect();
    const item = el.getBoundingClientRect();
    let delta = 0;
    if (item.left < box.left) delta = item.left - box.left;
    else if (item.right > box.right) delta = item.right - box.right;
    if (delta !== 0) scroller.scrollBy({ left: delta, behavior: 'auto' });
  }, [found]);

  if (items.length === 0) return null;
  const tabStop = Math.max(0, found);

  const onKeyDown = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return;
    const focused = Number(e.target.closest?.('[role="radio"]')?.dataset.index);
    const from = Number.isInteger(focused) ? focused : tabStop;
    let next;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (from + 1) % items.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (from - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    buttonRefs.current[next]?.focus();
    onChange(items[next].value);
  };

  return (
    <div ref={scrollerRef} className={`yy-seg${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      <div className="yy-seg__track" style={{ '--seg-n': items.length, '--seg-i': tabStop }} data-empty={found < 0 ? '' : undefined}>
        <span className="yy-seg__clip" aria-hidden="true">
          <span className="yy-seg__thumb" />
        </span>
        {items.map((it, i) => {
          const checked = i === found;
          return (
            <button
              type="button"
              key={it.value}
              ref={(el) => { buttonRefs.current[i] = el; }}
              role="radio"
              aria-checked={checked}
              tabIndex={i === tabStop ? 0 : -1}
              className={`yy-seg__item${checked ? ' is-checked' : ''}`}
              style={it.color ? { '--tribe-color': it.color } : undefined}
              data-value={it.value}
              data-index={i}
              onClick={() => onChange(it.value)}
            >
              {checked ? <Check size={14} className="yy-seg__check yy-icon" aria-hidden="true" /> : it.color && <span className="yy-seg__dot" aria-hidden="true" />}
              <span className="yy-seg__label">{it.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default TribeSegmented;
