import { useId, useState } from 'react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';
import MobileWordFilterOffcanvas from '../../../components/ui/MobileWordFilterOffcanvas';
import WordFilterControls from '../../../components/ui/WordFilterControls';
import { countActiveFilters } from '../../../utils/wordFilterState';
import '../../../static/css/_search/activeFilters.css';

// 排序／開頭字母／詞頻／只顯示收藏 這幾個篩選控制項：手機版用共用的 MobileWordFilterOffcanvas 抽屜，
// 桌面版用同一組 chip 控制項（WordFilterControls），三個頁面共用同一套外觀（審查項 P2-20）。
// activeExtraCount 是抽屜以外也算進「篩選（N）」的條件數（例如已選的分類）。
const FilterPanel = ({
  isMobile,
  showFilterPanel, setShowFilterPanel,
  sortOrder, setSortOrder,
  filterLetter, setFilterLetter,
  frequencyFilter, setFrequencyFilter,
  showOnlyFavorites, setShowOnlyFavorites,
  alphabet,
  activeExtraCount = 0,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const panelId = useId();
  if (isMobile) {
    return (
      <MobileWordFilterOffcanvas
        show={showFilterPanel}
        onOpen={() => setShowFilterPanel(true)}
        onClose={() => setShowFilterPanel(false)}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        filterLetter={filterLetter}
        onFilterLetterChange={setFilterLetter}
        alphabet={alphabet}
        frequencyFilter={frequencyFilter}
        onFrequencyFilterChange={setFrequencyFilter}
        showFavoritesToggle
        showOnlyFavorites={showOnlyFavorites}
        onToggleFavorites={() => setShowOnlyFavorites(prev => !prev)}
        extraActiveCount={activeExtraCount}
        // 稽核 FE3-16：跟桌面「進階篩選」鈕同一個 id，移除最後一個篩選 chip 後焦點回到這裡
        triggerId="search-advanced-toggle"
      />
    );
  }

  // 桌面：預設只剩搜尋框；排序、詞頻、字母收進折疊。折疊狀態用文字說明（展開／收起），並顯示已套用幾項
  const activeCount = countActiveFilters({ filterLetter, frequencyFilter, showOnlyFavorites, extra: activeExtraCount });
  return (
    <div className="search-filter-panel">
      <button
        type="button"
        id="search-advanced-toggle"
        className="wf-disclosure"
        aria-expanded={advancedOpen}
        aria-controls={panelId}
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        <SlidersHorizontal size={18} className="yy-icon" aria-hidden="true" />
        進階篩選
        <span className="wf-disclosure-state">{advancedOpen ? '收起' : '展開'}</span>
        {activeCount > 0 && <span className="wf-disclosure-count">已套用 {activeCount} 項</span>}
        <ChevronDown size={16} className="yy-icon" aria-hidden="true" style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none' }} />
      </button>
      <div id={panelId} hidden={!advancedOpen}>
      <WordFilterControls
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        filterLetter={filterLetter}
        onFilterLetterChange={setFilterLetter}
        alphabet={alphabet}
        frequencyFilter={frequencyFilter}
        onFrequencyFilterChange={setFrequencyFilter}
        showOnlyFavorites={showOnlyFavorites}
        onToggleFavorites={() => setShowOnlyFavorites(prev => !prev)}
      />
      </div>
    </div>
  );
};

export default FilterPanel;
