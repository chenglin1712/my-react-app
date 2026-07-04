import { InputGroup, Form, Button } from 'react-bootstrap';
import TribeSelector from './TribeSelector';
import FilterPanel from './FilterPanel';
import CategoryBar from './CategoryBar';

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
  <div style={{
    position: 'sticky',
    top: 0,
    background: 'white',
    zIndex: 900,
    paddingBottom: '1rem',
    marginBottom: '1rem',
    borderBottom: '1px solid #ccc'
  }}>
    <br />
    <h2 className="fw-bolder center" style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', marginBottom: 0 }}>
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="currentColor" className="bi bi-search" viewBox="0 0 16 16">
        <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
      </svg>&nbsp; 單詞查詢
    </h2>

    {/* 族語選擇器 */}
    <TribeSelector tribes={tribes} selectedTribe={selectedTribe} onTribeChange={handleTribeChange} />

    <InputGroup className="mb-3">
      <Form.Control
        placeholder="請輸入查詢內容"
        value={query}
        maxLength={SEARCH_INPUT_MAX_LENGTH}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSearch();
          }
        }}
      />
      <Button variant="danger" onClick={() => handleSearch()} disabled={loading} style={{ maxWidth: '60px', paddingLeft: '6px', paddingRight: '6px' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" className="bi bi-search" viewBox="0 0 16 16">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
        </svg>
      </Button>
    </InputGroup>
    <div className="d-flex mb-3 align-items-center">
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
    {/* 📂 分類Bar */}
    <CategoryBar
      showCategories={showCategories} setShowCategories={setShowCategories}
      activeTab={activeTab} setActiveTab={setActiveTab}
      selectedSubCategory={selectedSubCategory} setSelectedSubCategory={setSelectedSubCategory}
    />
  </div>
);

export default SearchHeader;
