import { useRef } from 'react';

/**
 * 兩段式頁籤切換（登入/註冊、寫筆記/分享區）：active 態赭紅底。
 *
 * ARIA tabs 樣式：tablist / tab / aria-selected，只有目前這一籤在 Tab 順序裡（roving tabindex），
 * 方向鍵、Home、End 在頁籤之間移動焦點。採「手動啟用」：方向鍵只移動焦點，按 Enter／空白鍵才切換，
 * 因為有些頁籤（寫筆記 → 分享區）切換等於換頁，不能因為使用者用方向鍵瀏覽就把頁面換掉。
 *
 * 頁籤對應的內容區如果有 id，在 tab 物件加上 panelId，會連到 aria-controls。
 */
const TabSwitch = ({ tabs, active, onChange, ariaLabel, idPrefix = 'yy-tab' }) => {
  const tabRefs = useRef([]);

  const moveFocus = (index) => {
    const next = (index + tabs.length) % tabs.length;
    tabRefs.current[next]?.focus();
  };

  const handleKeyDown = (event, index) => {
    switch (event.key) {
      case 'ArrowRight': event.preventDefault(); moveFocus(index + 1); break;
      case 'ArrowLeft': event.preventDefault(); moveFocus(index - 1); break;
      case 'Home': event.preventDefault(); moveFocus(0); break;
      case 'End': event.preventDefault(); moveFocus(tabs.length - 1); break;
      default: break;
    }
  };

  return (
    <div className="yy-tabswitch" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const selected = active === tab.key;
        return (
          <button
            type="button"
            role="tab"
            key={tab.key}
            id={`${idPrefix}-${tab.key}`}
            ref={(element) => { tabRefs.current[index] = element; }}
            className={`yy-tabswitch__tab${selected ? ' active' : ''}`}
            aria-selected={selected}
            aria-controls={tab.panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

export default TabSwitch;
