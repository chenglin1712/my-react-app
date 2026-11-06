import { useId, useState } from 'react';
import { Search } from 'lucide-react';
import useSearchSuggestions from './useSearchSuggestions';

// Spotlight 式大搜尋框（Apple 化步驟 4-2）：圓角大輸入框加即時建議清單。
// 建議清單用 combobox／listbox 模式：焦點一直留在輸入框，上下鍵移動「作用中」的選項
// （aria-activedescendant），Enter 選取、Esc 關閉。滑鼠點選項用 onMouseDown 擋掉失焦，
// 不然清單會在 click 之前先被關掉。
const SEARCH_INPUT_MAX_LENGTH = 100;

const SearchSpotlight = ({ query, setQuery, handleSearch, loading, selectedTribe }) => {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // 輸入法組字中（注音、拼音選字還沒確定）不查建議，確定後才查，不然會拿著半成品字串打 API
  const [composing, setComposing] = useState(false);
  // 按下搜尋或選了建議之後，同一段輸入不再跳出建議，直到使用者又改了輸入
  const [dismissedQuery, setDismissedQuery] = useState(null);

  const suggestions = useSearchSuggestions(query, selectedTribe, focused && !composing && dismissedQuery !== query);
  const open = focused && !composing && dismissedQuery !== query && suggestions.length > 0;
  const optionId = (i) => `${listId}-opt-${i}`;

  const submit = (keyword) => {
    setDismissedQuery(keyword ?? query);
    setActiveIndex(-1);
    handleSearch(null, keyword ?? null);
  };

  const choose = (item) => {
    setQuery(item.name);
    submit(item.name);
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 229：部分瀏覽器組字中的按鍵
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setDismissedQuery(query);
      setActiveIndex(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && suggestions[activeIndex]) choose(suggestions[activeIndex]);
      else submit();
    }
  };

  return (
    <div className="spotlight" role="search">
      <div className="spotlight-field">
        <Search size={22} className="spotlight-icon" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          className="spotlight-input"
          placeholder="輸入中文或族語詞彙"
          aria-label="查詢關鍵字"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          value={query}
          maxLength={SEARCH_INPUT_MAX_LENGTH}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="spotlight-go" onClick={() => submit()} disabled={loading}>
          搜尋
        </button>
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label="查詢建議"
        className="spotlight-list"
        hidden={!open}
        onMouseDown={(e) => e.preventDefault()}
      >
        {open && suggestions.map((item, i) => (
          <li
            key={item.name}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            className={`spotlight-option${i === activeIndex ? ' is-active' : ''}`}
            onClick={() => choose(item)}
          >
            <span className="spotlight-option-name">{item.name}</span>
            {item.gloss && <span className="spotlight-option-gloss">{item.gloss}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SearchSpotlight;
