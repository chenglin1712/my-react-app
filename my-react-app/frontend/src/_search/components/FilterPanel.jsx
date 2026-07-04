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
    </div>
  );
};

export default FilterPanel;
