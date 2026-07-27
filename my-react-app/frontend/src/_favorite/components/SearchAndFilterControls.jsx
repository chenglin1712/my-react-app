import {
  Button, InputGroup, Form, Dropdown, Tabs, Tab, Offcanvas
} from 'react-bootstrap';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { categoryGroups } from "../../constants/categoryGroups";

//搜尋篩選組件
const SearchAndFilterControls = ({ _tab, state, onStateChange, alphabet, isMobile, activeTabcat, setActiveTabcat,
   showCategories, setShowCategories, selectedSubCategory, setSelectedSubCategory, showFilterPanel, setShowFilterPanel }) => (
  <>
    <InputGroup className="mb-3">
      <Form.Control
        placeholder="請輸入查詢內容"
        value={state.inputValue || ''}
        onChange={e => onStateChange('inputValue', e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            onStateChange('activeQuery', state.inputValue);
          }
        }}
      />
      <Button
        variant="danger"
        onClick={() => onStateChange('activeQuery', state.inputValue)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" className="bi bi-search" viewBox="0 0 16 16">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
        </svg>
      </Button>
    </InputGroup>
    <div className="d-flex mb-3 align-items-center">
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
                        onStateChange('sortOrder', state.sortOrder === 'asc' ? 'desc' : 'asc');
                        setShowFilterPanel(false);
                      }}
                    >
                      排序： {state.sortOrder === 'asc' ? 'A→Z' : 'Z→A'}
                    </Button>

                    <Dropdown onSelect={val => {
                      onStateChange('filterLetter', val);
                      setShowFilterPanel(false);
                    }}>
                      <Dropdown.Toggle variant="outline-dark" className="btn">
                        開頭： {state.filterLetter || '全部'}
                      </Dropdown.Toggle>
                      <Dropdown.Menu style={{ maxHeight: '400px', overflowY: 'auto' }}>
                        <Dropdown.Item eventKey="">全部</Dropdown.Item>
                        {alphabet.map(l => (
                          <Dropdown.Item key={l} eventKey={l}>{l}</Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    </Dropdown>

                    <Dropdown onSelect={(val) => {
                      onStateChange('frequencyFilter', val);
                      setShowFilterPanel(false);
                    }}>
                      <Dropdown.Toggle variant="outline-dark">
                        詞頻： {state.frequencyFilter ? `${state.frequencyFilter}★` : '全部'}
                      </Dropdown.Toggle>
                      <Dropdown.Menu>
                        <Dropdown.Item eventKey="">全部</Dropdown.Item>
                        {[5, 4, 3, 2, 1].map(n => (
                          <Dropdown.Item key={n} eventKey={n}>{`${n}★`}</Dropdown.Item>
                        ))}
                      </Dropdown.Menu>
                    </Dropdown>

                  </div>
                </Offcanvas.Body>
              </Offcanvas>
            </>
          ) : (
            <div className="d-flex align-items-center flex-wrap gap-2">
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => onStateChange('sortOrder', state.sortOrder === 'asc' ? 'desc' : 'asc')}
              >
                排序：{state.sortOrder === 'asc' ? 'A→Z' : 'Z→A'}
              </Button>

              <Dropdown onSelect={(val) => onStateChange('filterLetter', val)}>
                <Dropdown.Toggle variant="outline-secondary" size="sm">
                  開頭：{state.filterLetter || '全部'}
                </Dropdown.Toggle>
                <Dropdown.Menu style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  <Dropdown.Item eventKey="">全部</Dropdown.Item>
                  {alphabet.map(l => (
                    <Dropdown.Item key={l} eventKey={l}>{l}</Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>

              <Dropdown onSelect={(val) => onStateChange('frequencyFilter', val)}>
                <Dropdown.Toggle variant="outline-secondary" size="sm">
                  詞頻：{state.frequencyFilter ? `${state.frequencyFilter}★` : '全部'}
                </Dropdown.Toggle>
                <Dropdown.Menu>
                  <Dropdown.Item eventKey="">全部</Dropdown.Item>
                  {[5, 4, 3, 2, 1].map(n => (
                    <Dropdown.Item key={n} eventKey={n}>{`${n}★`}</Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown>
              </div>
            )}

        </div>
         {/* 📂 分類Bar */}
                  <div
                    className="category-bar d-flex justify-content-between align-items-center p-2 bg-light rounded shadow-sm"
                    onClick={() => setShowCategories(!showCategories)}
                    style={{ cursor: 'pointer',backgroundColor:"#fbcfcf",fontWeight: "bold" }}
                  >
                    <span className="fw-bold">單詞分類
                      {selectedSubCategory && (
                  <span style={{ marginLeft: "8px" }}>
                    - <span style={{color: "#ac3044ff" }}>{selectedSubCategory}</span>
                  </span>
                )}</span>
                    {showCategories ? <FaChevronUp /> : <FaChevronDown />}
                  </div>

                  {/* 展開分類 Tabs */}
                  {showCategories && (
                    <div className="mt-2 p-2 bg-white rounded shadow-sm">
                      <Tabs
                        activeKey={activeTabcat}
                        onSelect={(k) => setActiveTabcat(k)}
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
                                  onClick={() =>{
                                    setSelectedSubCategory(
                                      selectedSubCategory === sub.name ? null : sub.name
                                    );setShowCategories(!showCategories)}
                                  }
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

export default SearchAndFilterControls;
