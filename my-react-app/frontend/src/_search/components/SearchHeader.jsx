import { InputGroup, Form, Button } from 'react-bootstrap';
import TribeSelector from './TribeSelector';
import FilterPanel from './FilterPanel';
import CategoryBar from '../../../components/ui/CategoryBar';

// 搜尋頁最上方整個 sticky 區塊：標題、族語選擇器、搜尋框、篩選/排序面板、分類 Tabs。
const SEARCH_INPUT_MAX_LENGTH = 100;

const SearchHeader = ({
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
  <div className="search-sticky-header">
    <div className="search-hero-head yy-fade-up">
      <span className="yy-eyebrow">◆ SEARCH MODE ◆</span>
      <h1 className="search-hero-title">單詞查詢</h1>
      <p className="search-hero-desc">輸入關鍵字，或直接瀏覽五族語言的完整詞庫。</p>
    </div>

    {/* 族語選擇器 */}
    <TribeSelector tribes={tribes} selectedTribe={selectedTribe} onTribeChange={handleTribeChange} />

    <div className="search-card yy-card">
      <InputGroup className="search-terminal">
        <span className="search-terminal-prompt">&gt;</span>
        <Form.Control
          className="search-terminal-input"
          placeholder="請輸入查詢內容"
          aria-label="查詢關鍵字"
          value={query}
          maxLength={SEARCH_INPUT_MAX_LENGTH}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSearch();
            }
          }}
        />
        <Button type="button" aria-label="搜尋" className="search-go-btn" onClick={() => handleSearch()} disabled={loading}>
          GO ▸
        </Button>
      </InputGroup>

      <div className="d-flex mb-0 align-items-center">
        <FilterPanel
          isMobile={isMobile}
          showFilterPanel={showFilterPanel} setShowFilterPanel={setShowFilterPanel}
          sortOrder={sortOrder} setSortOrder={setSortOrder}
          filterLetter={filterLetter} setFilterLetter={setFilterLetter}
          frequencyFilter={frequencyFilter} setFrequencyFilter={setFrequencyFilter}
          showOnlyFavorites={showOnlyFavorites} setShowOnlyFavorites={setShowOnlyFavorites}
          alphabet={alphabet}
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
