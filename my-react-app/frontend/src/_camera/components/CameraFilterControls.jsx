import { Button, Dropdown, Offcanvas, Tabs, Tab } from 'react-bootstrap';
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { categoryGroups } from "../../constants/categoryGroups";

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
          <>
            <Button variant="outline-dark" className="mb-3" onClick={() => setShowFilterPanel(true)}>
              篩選 / 排序
            </Button>

            <Offcanvas show={showFilterPanel} onHide={() => setShowFilterPanel(false)} placement="end">
              <Offcanvas.Header closeButton>
                <Offcanvas.Title>篩選 / 排序選項</Offcanvas.Title>
              </Offcanvas.Header>
              <Offcanvas.Body>
                <div className="d-flex flex-column gap-3">
                  <Button
                    variant="outline-dark"
                    onClick={() => {
                      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
                      setShowFilterPanel(false);
                    }}
                  >
                    排序： {sortOrder === 'asc' ? 'A→Z' : 'Z→A'}
                  </Button>

                  <Dropdown onSelect={val => {
                    setFilterLetter(val);
                    setShowFilterPanel(false);
                  }}>
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

                  <Dropdown onSelect={(val) => {
                    setFrequencyFilter(val);
                    setShowFilterPanel(false);
                  }}>
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
                    variant={showOnlyFavorites ? "danger" : "outline-dark"}
                    onClick={() => {
                      setShowOnlyFavorites(prev => !prev);
                      setShowFilterPanel(false);
                    }}
                  >
                    {showOnlyFavorites ? '顯示全部' : '只顯示收藏'}
                  </Button>

                  <Button variant="outline-danger" onClick={onRestart}>
                    {backIcon}
                    &nbsp; 返回
                  </Button>
                </div>
              </Offcanvas.Body>
            </Offcanvas>
          </>
        ) : (
          <div className="d-flex mb-3 align-items-center flex-wrap gap-2">
            <Button
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
              className="ms-3"
              variant={showOnlyFavorites ? "danger" : "outline-dark"}
              onClick={() => setShowOnlyFavorites(prev => !prev)}
            >
              {showOnlyFavorites ? '顯示全部' : '只顯示收藏'}
            </Button>

            <Button className="ms-3" variant="outline-danger" onClick={onRestart}>
              {backIcon}
              &nbsp; 返回
            </Button>
          </div>
        )}
      </div>

      {/* 📂 分類Bar */}
      <div
        className="category-bar yy-card d-flex justify-content-between align-items-center"
        role="button"
        tabIndex={0}
        onClick={() => setShowCategories(!showCategories)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowCategories(!showCategories); } }}
      >
        <span className="fw-bold">📂 單詞分類
          {selectedSubCategory && (
            <span style={{ marginLeft: "8px" }}>
              - <span style={{ color: "var(--yy-red)" }}>{selectedSubCategory}</span>
            </span>
          )}</span>
        {showCategories ? <FaChevronUp /> : <FaChevronDown />}
      </div>

      {/* 展開分類 Tabs */}
      {showCategories && (
        <div className="category-panel yy-card mt-2">
          <Tabs
            activeKey={activeTab}
            onSelect={(k) => setActiveTab(k)}
            className="mb-3"
            justify
          >
            {Object.keys(categoryGroups).map((group) => (
              <Tab eventKey={group} title={group} key={group}>
                <div className="subcategory-scroll">
                  {categoryGroups[group].map((sub) => (
                    <div
                      key={sub.name}
                      className={`subcategory-card ${
                        selectedSubCategory === sub.name ? 'active' : ''
                      }`}
                      onClick={() => {
                        setSelectedSubCategory(
                          selectedSubCategory === sub.name ? null : sub.name
                        ); setShowCategories(!showCategories);
                      }}
                    >
                      <img src={sub.image} alt={sub.name} loading="lazy" />
                      <h5 className="fw-bold">{sub.name}</h5>
                    </div>
                  ))}
                </div>
              </Tab>
            ))}
          </Tabs>
        </div>
      )}
    </>
  );
}
