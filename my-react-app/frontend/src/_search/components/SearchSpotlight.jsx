import { useId, useState } from 'react';
import { Search, History, Trash2 } from 'lucide-react';
import useSearchSuggestions from './useSearchSuggestions';
import { announce } from '@utils/announce';
import { loadRecentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches } from '../../../utils/recentSearches';

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

  // 最近搜尋（P2-4）：只存在本機。搜尋框是空的又取得焦點時，清單顯示最近搜尋，上下鍵選、Enter 搜、Delete 移除單筆，
  // 最後一個選項是「清除最近搜尋」（鍵盤與螢幕閱讀器都碰得到，不靠只有滑鼠能按的小叉叉）。
  const [recents, setRecents] = useState([]);
  const showRecents = focused && !composing && dismissedQuery !== query && query.trim() === '' && recents.length > 0;
  const suggestions = useSearchSuggestions(query, selectedTribe, focused && !composing && dismissedQuery !== query);
  const options = showRecents
    ? [...recents.map((name) => ({ name, kind: 'recent' })), { name: '清除最近搜尋', gloss: '只存在這部裝置', kind: 'clear' }]
    : suggestions;
  const open = focused && !composing && dismissedQuery !== query && options.length > 0;
  const optionId = (i) => `${listId}-opt-${i}`;

  const submit = (keyword) => {
    setDismissedQuery(keyword ?? query);
    setActiveIndex(-1);
    // 只記真的輸入過的關鍵字（空白搜尋是瀏覽全部，不記）
    setRecents(addRecentSearch(keyword ?? query));
    handleSearch(null, keyword ?? null);
  };

  const choose = (item) => {
    if (item.kind === 'clear') {
      setRecents(clearRecentSearches());
      setActiveIndex(-1);
      announce('已清除最近搜尋');
      return;
    }
    setQuery(item.name);
    submit(item.name);
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // 229：部分瀏覽器組字中的按鍵
    if (e.key === 'ArrowDown' && open) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp' && open) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Delete' && open && options[activeIndex]?.kind === 'recent') {
      e.preventDefault();
      const removed = options[activeIndex].name;
      setRecents(removeRecentSearch(removed));
      setActiveIndex(-1);
      announce(`已移除最近搜尋「${removed}」`);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setDismissedQuery(query);
      setActiveIndex(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && activeIndex >= 0 && options[activeIndex]) choose(options[activeIndex]);
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
          data-hotkey-search
          className="spotlight-input"
          placeholder="輸入中文或族語詞彙"
          aria-label="查詢關鍵字"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          // 稽核 FE3-02：手機預設會把詞首大寫、把 ' 換成 ’、自動改字，族語拼寫會被改掉；一律關掉
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          maxLength={SEARCH_INPUT_MAX_LENGTH}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onFocus={() => { setRecents(loadRecentSearches()); setFocused(true); }}
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
        aria-label={showRecents ? '最近搜尋' : '查詢建議'}
        className="spotlight-list"
        hidden={!open}
        onMouseDown={(e) => e.preventDefault()}
      >
        {open && options.map((item, i) => (
          <li
            key={`${item.kind || 'word'}-${item.name}`}
            id={optionId(i)}
            role="option"
            aria-selected={i === activeIndex}
            className={`spotlight-option${item.kind ? ` spotlight-option--${item.kind}` : ''}${i === activeIndex ? ' is-active' : ''}`}
            onClick={() => choose(item)}
          >
            {item.kind === 'recent' && <History size={16} className="yy-icon spotlight-option-icon" aria-hidden="true" />}
            {item.kind === 'clear' && <Trash2 size={16} className="yy-icon spotlight-option-icon" aria-hidden="true" />}
            <span className="spotlight-option-name">{item.name}</span>
            {item.gloss && <span className="spotlight-option-gloss">{item.gloss}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SearchSpotlight;
