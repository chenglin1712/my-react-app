import { Button, Dropdown, Offcanvas } from 'react-bootstrap';

// 排序／開頭字母／詞頻／只顯示收藏 這幾個篩選控制項，手機版用 Offcanvas
// 抽屜、桌面版用同一列 inline 控制項，兩邊邏輯完全一樣只是排版不同。
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
            </div>
          </Offcanvas.Body>
        </Offcanvas>
      </>
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
