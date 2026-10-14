import {
  Button, InputGroup, Form
} from 'react-bootstrap';
import CategoryBar from '../../../components/ui/CategoryBar';
import MobileWordFilterOffcanvas from '../../../components/ui/MobileWordFilterOffcanvas';
import WordFilterControls from '../../../components/ui/WordFilterControls';

//搜尋篩選組件
const SearchAndFilterControls = ({ state, onStateChange, alphabet, isMobile, activeTabcat, setActiveTabcat,
   showCategories, setShowCategories, selectedSubCategory, setSelectedSubCategory, showFilterPanel, setShowFilterPanel }) => (
  <>
    <InputGroup className="mb-3">
      <Form.Control
        placeholder="請輸入查詢內容"
        aria-label="查詢關鍵字"
        value={state.inputValue || ''}
        onChange={e => onStateChange('inputValue', e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            onStateChange('activeQuery', state.inputValue);
          }
        }}
      />
      <Button
        type="button"
        variant="danger"
        aria-label="搜尋"
        onClick={() => onStateChange('activeQuery', state.inputValue)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" className="bi bi-search" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
        </svg>
      </Button>
    </InputGroup>
    <div className="d-flex mb-3 align-items-center">
      {isMobile ? (
        <MobileWordFilterOffcanvas
          show={showFilterPanel}
          onOpen={() => setShowFilterPanel(true)}
          onClose={() => setShowFilterPanel(false)}
          sortOrder={state.sortOrder}
          onSortOrderChange={(val) => onStateChange('sortOrder', val)}
          filterLetter={state.filterLetter}
          onFilterLetterChange={(val) => onStateChange('filterLetter', val)}
          alphabet={alphabet}
          frequencyFilter={state.frequencyFilter}
          onFrequencyFilterChange={(val) => onStateChange('frequencyFilter', val)}
          extraActiveCount={selectedSubCategory ? 1 : 0}
        />
      ) : (
        <WordFilterControls
          sortOrder={state.sortOrder}
          onSortOrderChange={(val) => onStateChange('sortOrder', val)}
          filterLetter={state.filterLetter}
          onFilterLetterChange={(val) => onStateChange('filterLetter', val)}
          alphabet={alphabet}
          frequencyFilter={state.frequencyFilter}
          onFrequencyFilterChange={(val) => onStateChange('frequencyFilter', val)}
        />
      )}
    </div>
    <CategoryBar
      showCategories={showCategories}
      setShowCategories={setShowCategories}
      activeTab={activeTabcat}
      setActiveTab={setActiveTabcat}
      selectedSubCategory={selectedSubCategory}
      setSelectedSubCategory={setSelectedSubCategory}
    />
  </>
);

export default SearchAndFilterControls;
