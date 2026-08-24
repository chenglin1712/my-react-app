import { Button, Dropdown } from 'react-bootstrap';
import CategoryBar from '../../../components/ui/CategoryBar';
import MobileWordFilterOffcanvas from '../../../components/ui/MobileWordFilterOffcanvas';

/** 影像辨識精靈第 3 步的排序／篩選／分類 UI，從 _camera/result.jsx 抽出來。 */
export default function CameraFilterControls({
  isMobile, showFilterPanel, setShowFilterPanel,
  sortOrder, setSortOrder, filterLetter, setFilterLetter, alphabet,
  frequencyFilter, setFrequencyFilter, showOnlyFavorites, setShowOnlyFavorites,
  showCategories, setShowCategories, activeTab, setActiveTab, selectedSubCategory, setSelectedSubCategory,
  onRestart,
}) {
  const backIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-arrow-return-left" viewBox="0 0 16 16">
      <path fillRule="evenodd" d="M14.5 1.5a.5.5 0 0 1 .5.5v4.8a2.5 2.5 0 0 1-2.5 2.5H2.707l3.347 3.346a.5.5 0 0 1-.708.708l-4.2-4.2a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 8.3H12.5A1.5 1.5 0 0 0 14 6.8V2a.5.5 0 0 1 .5-.5" />
    </svg>
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
            footer={(
              <Button type="button" variant="outline-danger" onClick={onRestart}>
                {backIcon}
                &nbsp; 返回
              </Button>
            )}
          />
        ) : (
          <div className="d-flex mb-3 align-items-center flex-wrap gap-2">
            <Button
              type="button"
              variant="outline-dark"
              className="me-3"
              onClick={() => setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'))}
            >
              排序： {sortOrder === 'asc' ? 'A→Z' : 'Z→A'}
            </Button>

            <Dropdown onSelect={val => setFilterLetter(val)}>
              <Dropdown.Toggle variant="outline-dark" className="btn">
                開頭： {filterLetter || '全部'}
              </Dropdown.Toggle>
              <Dropdown.Menu style={{ maxHeight: '400px', overflowY: 'auto' }}>
                <Dropdown.Item eventKey="">全部</Dropdown.Item>
                {alphabet.map(l => (
                  <Dropdown.Item key={l} eventKey={l}>{l}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>

            <Dropdown onSelect={(val) => setFrequencyFilter(val)} className="ms-3">
              <Dropdown.Toggle variant="outline-dark">
                詞頻： {frequencyFilter ? `${frequencyFilter}★` : '全部'}
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item eventKey="">全部</Dropdown.Item>
                {[5, 4, 3, 2, 1].map(n => (
                  <Dropdown.Item key={n} eventKey={n}>{`${n}★`}</Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>

            <Button
              type="button"
              className="ms-3"
              variant={showOnlyFavorites ? "danger" : "outline-dark"}
              onClick={() => setShowOnlyFavorites(prev => !prev)}
            >
              {showOnlyFavorites ? '顯示全部' : '只顯示收藏'}
            </Button>

            <Button type="button" className="ms-3" variant="outline-danger" onClick={onRestart}>
              {backIcon}
              &nbsp; 返回
            </Button>
          </div>
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
