import MobileWordFilterOffcanvas from '../../../components/ui/MobileWordFilterOffcanvas';
import WordFilterControls from '../../../components/ui/WordFilterControls';

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
      />
    );
  }

  return (
    <div className="search-filter-panel">
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
  );
};

export default FilterPanel;
