import { Tabs, Tab } from 'react-bootstrap';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { categoryGroups } from "../../constants/categoryGroups";

const CategoryBar = ({
  showCategories, setShowCategories,
  activeTab, setActiveTab,
  selectedSubCategory, setSelectedSubCategory,
}) => (
  <>
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
                {categoryGroups[group].map((sub) => {
                  const selectSubCategory = () => {
                    setSelectedSubCategory(selectedSubCategory === sub.name ? null : sub.name);
                    setShowCategories(!showCategories);
                  };
                  return (
                    <div
                      key={sub.name}
                      className={`subcategory-card ${selectedSubCategory === sub.name ? 'active' : ''
                        }`}
                      role="button"
                      tabIndex={0}
                      onClick={selectSubCategory}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSubCategory(); } }}
                    >
                      <img src={sub.image} alt={sub.name} loading="lazy" />
                      <h5 className="fw-bold">{sub.name}</h5>
                    </div>
                  );
                })}
              </div>
            </Tab>
          ))}
        </Tabs>
      </div>
    )}
  </>
);

export default CategoryBar;
