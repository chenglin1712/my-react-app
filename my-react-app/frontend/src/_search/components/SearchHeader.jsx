import SearchSpotlight from './SearchSpotlight';
import TribeSelector from './TribeSelector';
import FilterPanel from './FilterPanel';
import CategoryBar from '../../../components/ui/CategoryBar';

// 搜尋頁最上方的區塊：標題、族語選擇器、搜尋框、篩選/排序面板、分類 Tabs。
// 這一整塊很高（桌面約 500px），所以【不】釘在畫面上，照一般流程捲走；捲出去之後由
// CompactSearchBar（精簡搜尋列）接手。原本整塊 sticky 時，結果列表只剩一小條可看、詞條被頁首蓋住。
const SearchHeader = ({
  headerRef,
  query, setQuery, handleSearch,
  loading,
  tribes, selectedTribe, handleTribeChange,
  isMobile,
  showFilterPanel, setShowFilterPanel,
  sortOrder, setSortOrder,
  filterLetter, setFilterLetter,
  frequencyFilter, setFrequencyFilter,
  showOnlyFavorites, setShowOnlyFavorites,
  alphabet,
  showCategories, setShowCategories,
  activeTab, setActiveTab,
  selectedSubCategory, setSelectedSubCategory,
}) => (
  <div className="search-header-block" ref={headerRef}>
    <div className="search-hero-head yy-fade-up">
      <h1 className="search-hero-title">單詞查詢</h1>
      <p className="search-hero-desc">輸入關鍵字，或直接瀏覽五族語言的完整詞庫。</p>
    </div>

    {/* 族語選擇器 */}
    <TribeSelector tribes={tribes} selectedTribe={selectedTribe} onTribeChange={handleTribeChange} />

    <div className="search-card">
      <SearchSpotlight
        query={query} setQuery={setQuery} handleSearch={handleSearch}
        loading={loading} selectedTribe={selectedTribe}
      />

      <div className="d-flex mb-0 align-items-center">
        <FilterPanel
          isMobile={isMobile}
          showFilterPanel={showFilterPanel} setShowFilterPanel={setShowFilterPanel}
          sortOrder={sortOrder} setSortOrder={setSortOrder}
          filterLetter={filterLetter} setFilterLetter={setFilterLetter}
          frequencyFilter={frequencyFilter} setFrequencyFilter={setFrequencyFilter}
          showOnlyFavorites={showOnlyFavorites} setShowOnlyFavorites={setShowOnlyFavorites}
          alphabet={alphabet}
          activeExtraCount={selectedSubCategory ? 1 : 0}
        />
      </div>
    </div>

    {/* 📂 分類Bar */}
    <CategoryBar
      showCategories={showCategories} setShowCategories={setShowCategories}
      activeTab={activeTab} setActiveTab={setActiveTab}
      selectedSubCategory={selectedSubCategory} setSelectedSubCategory={setSelectedSubCategory}
    />
  </div>
);

export default SearchHeader;
