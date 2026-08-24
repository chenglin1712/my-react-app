import { Tabs, Tab } from "react-bootstrap";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { categoryGroups } from "../../src/constants/categoryGroups";
import "../../static/css/ui/categoryBar.css";

/**
 * 「單詞分類」下拉/Tabs 面板：原本 _search、_camera、_favorite 三邊各自維護
 * 一份幾乎逐行相同的實作，且已經彼此走鐘（收藏版完全沒有鍵盤支援、相機版
 * 只有外層 header 有鍵盤支援子分類卡片沒有），這裡收斂成一份共用元件。
 */
export default function CategoryBar({
  showCategories, setShowCategories,
  activeTab, setActiveTab,
  selectedSubCategory, setSelectedSubCategory,
}) {
  const selectSubCategory = (sub) => {
    setSelectedSubCategory(selectedSubCategory === sub.name ? null : sub.name);
    // 選了子分類後就收起面板——這裡不是真的在「切換」showCategories（進到這個
    // 函式時面板一定是開著的），寫成 setShowCategories(false) 比較不會誤讀。
    setShowCategories(false);
  };

  return (
    <>
      <button
        type="button"
        className="category-bar yy-card d-flex justify-content-between align-items-center"
        onClick={() => setShowCategories(!showCategories)}
        aria-expanded={showCategories}
      >
        <span className="fw-bold">📂 單詞分類
          {selectedSubCategory && (
            <span style={{ marginLeft: "8px" }}>
              - <span style={{ color: "var(--yy-red)" }}>{selectedSubCategory}</span>
            </span>
          )}
        </span>
        {showCategories ? <FaChevronUp /> : <FaChevronDown />}
      </button>

      {showCategories && (
        <div className="category-panel yy-card mt-2">
          <Tabs activeKey={activeTab} onSelect={(k) => setActiveTab(k)} className="mb-3" justify>
            {Object.keys(categoryGroups).map((group) => (
              <Tab eventKey={group} title={group} key={group}>
                <div className="subcategory-scroll">
                  {categoryGroups[group].map((sub) => (
                    <button
                      type="button"
                      key={sub.name}
                      className={`subcategory-card ${selectedSubCategory === sub.name ? "active" : ""}`}
                      aria-pressed={selectedSubCategory === sub.name}
                      onClick={() => selectSubCategory(sub)}
                    >
                      <img src={sub.image} alt={sub.name} loading="lazy" />
                      <h5 className="fw-bold">{sub.name}</h5>
                    </button>
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
