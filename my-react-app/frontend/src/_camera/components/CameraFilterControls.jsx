import { Button } from 'react-bootstrap';
import CategoryBar from '../../../components/ui/CategoryBar';
import MobileWordFilterOffcanvas from '../../../components/ui/MobileWordFilterOffcanvas';
import WordFilterControls from '../../../components/ui/WordFilterControls';

/** 影像辨識精靈第 3 步的排序／篩選／分類 UI，從 _camera/result.jsx 抽出來。 */
export default function CameraFilterControls({
  isMobile, showFilterPanel, setShowFilterPanel,
  sortOrder, setSortOrder, filterLetter, setFilterLetter, alphabet,
  frequencyFilter, setFrequencyFilter, showOnlyFavorites, setShowOnlyFavorites,
  showCategories, setShowCategories, activeTab, setActiveTab, selectedSubCategory, setSelectedSubCategory,
  onBack,
}) {
  const backIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-arrow-return-left" viewBox="0 0 16 16" aria-hidden="true">
      <path fillRule="evenodd" d="M14.5 1.5a.5.5 0 0 1 .5.5v4.8a2.5 2.5 0 0 1-2.5 2.5H2.707l3.347 3.346a.5.5 0 0 1-.708.708l-4.2-4.2a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 8.3H12.5A1.5 1.5 0 0 0 14 6.8V2a.5.5 0 0 1 .5-.5" />
    </svg>
  );

  const backButton = (
    <Button type="button" variant="outline-danger" onClick={onBack}>
      {backIcon}
      &nbsp; 回到選詞
    </Button>
  );

  return (
    <>
      <div className="camera-step3-filters">
        {isMobile ? (
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
            extraActiveCount={selectedSubCategory ? 1 : 0}
            footer={backButton}
          />
        ) : (
          <WordFilterControls
            className="mb-3"
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
            filterLetter={filterLetter}
            onFilterLetterChange={setFilterLetter}
            alphabet={alphabet}
            frequencyFilter={frequencyFilter}
            onFrequencyFilterChange={setFrequencyFilter}
            showOnlyFavorites={showOnlyFavorites}
            onToggleFavorites={() => setShowOnlyFavorites(prev => !prev)}
            extra={backButton}
          />
        )}
      </div>

      <CategoryBar
        showCategories={showCategories}
        setShowCategories={setShowCategories}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedSubCategory={selectedSubCategory}
        setSelectedSubCategory={setSelectedSubCategory}
      />
    </>
  );
}
