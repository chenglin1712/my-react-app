import { Tabs, Tab } from 'react-bootstrap';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';

import pronoun from "../../../static/assets/images/pronoun.png";
import auxiliary from "../../../static/assets/images/auxiliary.png";
import particle from "../../../static/assets/images/particle.png";
import negative from "../../../static/assets/images/negative.png";
import question from "../../../static/assets/images/question.png";

// === 人與社會 ===
import person from "../../../static/assets/images/person.png";
import family from "../../../static/assets/images/family.png";
import culture from "../../../static/assets/images/culture.png";
import religion from "../../../static/assets/images/religion.png";
import clothing from "../../../static/assets/images/clothing.png";
import action from "../../../static/assets/images/action.png";

// === 自然與環境 ===
import animal from "../../../static/assets/images/animal.png";
import plant from "../../../static/assets/images/plant.png";
import mountain from "../../../static/assets/images/mountain.png";
import nature from "../../../static/assets/images/nature.png";
import hunting from "../../../static/assets/images/hunting.png";
import farming from "../../../static/assets/images/farming.png";

// === 物質與生活 ===
import building from "../../../static/assets/images/building.png";
import transport from "../../../static/assets/images/transport.png";
import object from "../../../static/assets/images/object.png";
import food from "../../../static/assets/images/food.png";
import diet from "../../../static/assets/images/diet.png";
import daily from "../../../static/assets/images/daily.png";

// === 身體與感官 ===
import body from "../../../static/assets/images/body.png";
import move from "../../../static/assets/images/move.png";
import sense from "../../../static/assets/images/sense.png";
import emotion from "../../../static/assets/images/emotion.png";
import sound from "../../../static/assets/images/sound.png";
import life from "../../../static/assets/images/life.png";

// === 抽象概念 ===
import time from "../../../static/assets/images/time.png";
import number from "../../../static/assets/images/number.png";
import space from "../../../static/assets/images/space.png";
import feature from "../../../static/assets/images/feature.png";
import color from "../../../static/assets/images/color.png";
import abstract from "../../../static/assets/images/abstract.png";

// === 其他 ===
import other from "../../../static/assets/images/other.png";

// eslint-disable-next-line react-refresh/only-export-components
export const categoryGroups = {
  "語法與功能": [
    { name: "代名詞、指示詞", image: pronoun },
    { name: "助動詞", image: auxiliary },
    { name: "助詞或其他", image: particle },
    { name: "否定詞", image: negative },
    { name: "疑問詞", image: question },
  ],
  "人與社會": [
    { name: "人物、身分", image: person },
    { name: "親屬稱謂", image: family },
    { name: "傳統文化與習俗", image: culture },
    { name: "宗教", image: religion },
    { name: "織布服飾", image: clothing },
    { name: "行動", image: action },
  ],
  "自然與環境": [
    { name: "動物(含昆蟲)", image: animal },
    { name: "植物", image: plant },
    { name: "山川地理", image: mountain },
    { name: "自然景觀", image: nature },
    { name: "狩獵", image: hunting },
    { name: "農耕", image: farming },
  ],
  "物質與生活": [
    { name: "建築", image: building },
    { name: "交通", image: transport },
    { name: "物品(不含食品)", image: object },
    { name: "食物(非植物)", image: food },
    { name: "飲食", image: diet },
    { name: "生活作息", image: daily },
  ],
  "身體與感官": [
    { name: "身體部位", image: body },
    { name: "肢體動作", image: move },
    { name: "認知感官", image: sense },
    { name: "情緒思維", image: emotion },
    { name: "聲音", image: sound },
    { name: "生老病死傷", image: life },
  ],
  "抽象概念": [
    { name: "時間", image: time },
    { name: "數字計量", image: number },
    { name: "空間", image: space },
    { name: "特徵", image: feature },
    { name: "顏色", image: color },
    { name: "抽象名詞", image: abstract },
  ],
  "其他": [
    { name: "其他", image: other },
  ],
};

const CategoryBar = ({
  showCategories, setShowCategories,
  activeTab, setActiveTab,
  selectedSubCategory, setSelectedSubCategory,
}) => (
  <>
    <div
      className="category-bar d-flex justify-content-between align-items-center p-2 bg-light rounded shadow-sm"
      onClick={() => setShowCategories(!showCategories)}
      style={{ cursor: 'pointer', backgroundColor: "#fbcfcf", fontWeight: "bold" }}
    >
      <span className="fw-bold">單詞分類
        {selectedSubCategory && (
          <span style={{ marginLeft: "8px" }}>
            - <span style={{ color: "#ac3044ff" }}>{selectedSubCategory}</span>
          </span>
        )}</span>
      {showCategories ? <FaChevronUp /> : <FaChevronDown />}
    </div>

    {showCategories && (
      <div className="mt-2 p-2 bg-white rounded shadow-sm">
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
                    className={`subcategory-card ${selectedSubCategory === sub.name ? 'active' : ''
                      }`}
                    onClick={() => {
                      setSelectedSubCategory(
                        selectedSubCategory === sub.name ? null : sub.name
                      ); setShowCategories(!showCategories)
                    }
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

export default CategoryBar;
