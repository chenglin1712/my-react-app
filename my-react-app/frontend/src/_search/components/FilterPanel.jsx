import MobileWordFilterOffcanvas from '../../../components/ui/MobileWordFilterOffcanvas';

// 排序／開頭字母／詞頻／只顯示收藏 這幾個篩選控制項，手機版用共用的
// MobileWordFilterOffcanvas 抽屜、桌面版用同一列 inline chip 控制項。
const FilterPanel = ({
  isMobile,
  showFilterPanel, setShowFilterPanel,
  sortOrder, setSortOrder,
  filterLetter, setFilterLetter,
  frequencyFilter, setFrequencyFilter,
  showOnlyFavorites, setShowOnlyFavorites,
  alphabet,
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
      />
    );
  }

  return (
    <div className="search-filter-panel">
      <div className="d-flex mb-2 align-items-center flex-wrap gap-2">
        <button type="button" className="yy-btn-outline" onClick={() => setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))}>
          排序：{sortOrder === 'asc' ? 'A → Z' : 'Z → A'}
        </button>

        <button
          type="button"
          className="yy-btn-outline"
          style={showOnlyFavorites ? { background: 'var(--yy-red)', color: 'var(--yy-cream)' } : undefined}
          onClick={() => setShowOnlyFavorites(prev => !prev)}
        >
          {showOnlyFavorites ? '顯示全部' : '只顯示收藏'}
        </button>

        <div className="search-freq-row">
          <span className="search-freq-label">詞頻</span>
          {[1, 2, 3, 4, 5].map(n => (
            <button
              type="button"
              key={n}
              className="search-freq-chip"
              style={frequencyFilter === String(n) || frequencyFilter === n ? { background: 'var(--yy-gold)' } : undefined}
              onClick={() => setFrequencyFilter(prev => (String(prev) === String(n) ? '' : n))}
            >
              {n}★
            </button>
          ))}
        </div>
      </div>

      <div className="search-letter-row">
        {alphabet.map(l => (
          <button
            type="button"
            key={l}
            className="search-letter-chip"
            style={filterLetter === l ? { background: 'var(--yy-blue)', color: '#fff' } : undefined}
            onClick={() => setFilterLetter(prev => (prev === l ? '' : l))}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FilterPanel;
