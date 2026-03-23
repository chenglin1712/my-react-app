import { useState, useEffect } from 'react';
import {
  Container, Button, InputGroup, Form, Dropdown, Tabs, Tab, Offcanvas
} from 'react-bootstrap';
import { useLocation } from 'react-router-dom';
import { FaHeart, FaRegHeart, FaPlayCircle } from 'react-icons/fa';
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { authChanges } from "../../src/userServives/userServive";
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';
import PermissionProtect from "../userServives/permissionProtect";
import axios from 'axios';
import "../../static/css/_favorite/index_judy.css"

import pronoun from "../../static/assets/images/pronoun.png";
import auxiliary from "../../static/assets/images/auxiliary.png";
import particle from "../../static/assets/images/particle.png";
import negative from "../../static/assets/images/negative.png";
import question from "../../static/assets/images/question.png";

// === 人與社會 ===
import person from "../../static/assets/images/person.png";
import family from "../../static/assets/images/family.png";
import culture from "../../static/assets/images/culture.png";
import religion from "../../static/assets/images/religion.png";
import clothing from "../../static/assets/images/clothing.png";
import action from "../../static/assets/images/action.png";

// === 自然與環境 ===
import animal from "../../static/assets/images/animal.png";
import plant from "../../static/assets/images/plant.png";
import mountain from "../../static/assets/images/mountain.png";
import nature from "../../static/assets/images/nature.png";
import hunting from "../../static/assets/images/hunting.png";
import farming from "../../static/assets/images/farming.png";

// === 物質與生活 ===
import building from "../../static/assets/images/building.png";
import transport from "../../static/assets/images/transport.png";
import object from "../../static/assets/images/object.png";
import food from "../../static/assets/images/food.png";
import diet from "../../static/assets/images/diet.png";
import daily from "../../static/assets/images/daily.png";

// === 身體與感官 ===
import body from "../../static/assets/images/body.png";
import move from "../../static/assets/images/move.png";
import sense from "../../static/assets/images/sense.png";
import emotion from "../../static/assets/images/emotion.png";
import sound from "../../static/assets/images/sound.png";
import life from "../../static/assets/images/life.png";

// === 抽象概念 ===
import time from "../../static/assets/images/time.png";
import number from "../../static/assets/images/number.png";
import space from "../../static/assets/images/space.png";
import feature from "../../static/assets/images/feature.png";
import color from "../../static/assets/images/color.png";
import abstract from "../../static/assets/images/abstract.png";

// === 其他 ===
import other from "../../static/assets/images/other.png";

const StarRating = ({ fre }) => {
  if (fre === null || fre === undefined) return null;
  let starCount = 0;
  if (fre >= 0 && fre <= 50) starCount = 1;
  else if (fre <= 400) starCount = 2;
  else if (fre <= 800) starCount = 3;
  else if (fre <= 1000) starCount = 4;
  else starCount = 5;

  return (
    <>
      {[...Array(starCount)].map((_, i) => (
        <span key={i} >
          <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 640 640"><path fill="#FCC603" d="M341.5 45.1C337.4 37.1 329.1 32 320.1 32C311.1 32 302.8 37.1 298.7 45.1L225.1 189.3L65.2 214.7C56.3 216.1 48.9 222.4 46.1 231C43.3 239.6 45.6 249 51.9 255.4L166.3 369.9L141.1 529.8C139.7 538.7 143.4 547.7 150.7 553C158 558.3 167.6 559.1 175.7 555L320.1 481.6L464.4 555C472.4 559.1 482.1 558.3 489.4 553C496.7 547.7 500.4 538.8 499 529.8L473.7 369.9L588.1 255.4C594.5 249 596.7 239.6 593.9 231C591.1 222.4 583.8 216.1 574.8 214.7L415 189.3L341.5 45.1z"/></svg>
          </span>
      ))}
      {fre && <span style={{ marginLeft: '2px', color: '#666' }}>（{fre}）</span>}
    </>
  );
};

//播放按鈕組件
const AudioButton = ({ audioUrl, onPlay, size }) => {
  if (!audioUrl) return null;
  return (
    <Button
      variant="link"
      className="audio-button"
      onClick={(e) => {
        e.stopPropagation();
        onPlay(audioUrl);
      }}
    >
      <FaPlayCircle size={size} className="text-warning" />
    </Button>
  );
};

const WordCardImage = ({ imageUrl, word, isFavorited, onToggleFavorite }) => {
  const defaultImage = `https://www.shutterstock.com/image-vector/no-image-vector-symbol-missing-260nw-2151420819.jpg`;

  return (
    <div className="word-image-wrapper">
      <img
        src={imageUrl || defaultImage}
        alt={word}
        className="word-image"
      />

      <Button
        variant="link"
        className="favorite-btn"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
      >
        {isFavorited ? <FaHeart color="#dc2626" /> : <FaRegHeart color="#6b7280" />}
      </Button>
    </div>
  );
};

const WordCardInfo = ({ result, word, playAudio, category }) => (
  <div className="favorite-word-info">
    <h3 className="tayal-word">
      {result.name || '無資料'}
      <AudioButton audioUrl={result.audioItems?.[0]?.fileId} onPlay={playAudio} size={18} />
    </h3>
    <h5 className="chinese-word">{word}</h5>

    <div className="word-meta">
      {result.frequency && (
        <div className="word-frequency-label">
          詞頻：<StarRating fre={result.frequency} />
        </div>
      )}
      {result.explanationItems && (
  <>
    {result.explanationItems.map((def, i) =>
      def.category && def.category.length > 0 ? (
        <div className="word-category-label" key={i}>
          <span>{def.category}</span>
        </div>
      ) : null
    )}
  </>
)}

    </div>
  </div>
);

//例句組件
const ExampleItem = ({ example, playAudio }) => {
  const hasText = example.originalSentence?.trim() || example.chineseSentence?.trim();
  if (!hasText) return null;

  return (
    <div className="example-item">
      <div className="example-tayal">
        {example.originalSentence}
        <AudioButton audioUrl={example.audioItems?.[0]?.fileId} onPlay={playAudio} size={14} />
      </div>
      <div className="example-ch">{example.chineseSentence}</div>
    </div>
  );
};

//詳情組件
const DefinitionDetails = ({ definitions, playAudio }) => {
  if (!definitions?.length) return null;

  return (
    <div className="definitions-container">
      {definitions.map((def, i) => (
        <div key={i} className="definition-item">
          {def.category && (
            <h6 className="definition-category">
              <strong>例句</strong>
            </h6>
          )}

          {def.sentenceItems?.length > 0 && (
            <div className="examples-container">
              {def.sentenceItems.map((example, ei) => (
                <ExampleItem
                  key={ei}
                  example={example}
                  playAudio={playAudio}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

//單字卡
const WordCardWithImg = ({ word, category, result, keyName, expandedWord, toggleExpand, toggleFavorite, playAudio, isFavorited }) => {
  const isFlipped = expandedWord === keyName;

  return (
    <div className="word-card-container" key={keyName}>
      <div className={`word-card ${isFlipped ? 'flipped' : ''}`}>
        {/* 正面 */}
        <div className="word-card-front" onClick={() => toggleExpand(keyName)}>
          <WordCardImage
            imageUrl={result.word_img}
            word={result.name}
            isFavorited={isFavorited}
            onToggleFavorite={toggleFavorite}
          />

          <div className="word-card-header">
            <WordCardInfo
              result={result}
              word={word}
              playAudio={playAudio}
              category={category}
            />
          </div>
        </div>

        {/* 背面 */}
        <div className="word-card-back" onClick={() => toggleExpand(keyName)}>
          <div className="word-card-back-header">
            <h4 className="tayal-word-back">
              {result.name || '無資料'}
              <AudioButton audioUrl={result.audioItems?.[0]?.fileId} onPlay={playAudio} size={18} />
            </h4>
            <h5 className="chinese-word-back">{word}</h5>
          </div>

          <div className="word-card-details">
            <DefinitionDetails
              definitions={result.explanationItems}
              playAudio={(url) => {
                playAudio(url);
              }}
            />
          </div>

          {/* 返回按鈕 */}
          <div className="flip-back-btn">
            <small className="text-muted">點擊返回</small>
          </div>
        </div>
      </div>
    </div>
  );
};

//搜尋篩選組件
const SearchAndFilterControls = ({ tab, state, onStateChange, alphabet, isMobile, activeTabcat, setActiveTabcat, 
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
                                  <img src={sub.image} alt={sub.name} />
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

//狀態管理
const useTabState = (favorites) => {
  const [tabStates, setTabStates] = useState({});

  useEffect(() => {
    const newTabStates = {};
    favorites.forEach(fav => {
      if (!tabStates[fav.id]) {
        newTabStates[fav.id] = {
          inputValue: '',
          activeQuery: '',
          sortOrder: 'asc',
          filterLetter: '',
          frequencyFilter: ''
        };
      } else {
        newTabStates[fav.id] = tabStates[fav.id];
      }
    });
    setTabStates(newTabStates);
  }, [favorites]);

  const updateTabState = (tabId, key, value) => {
    setTabStates(prev => ({
      ...prev,
      [tabId]: {
        ...prev[tabId],
        [key]: value
      }
    }));
  };

  return [tabStates, updateTabState];
};
const categoryGroups = {
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

//篩選和排序功能
const useFilterAndSort = (allWords) => {
  const matchSearchCriteria = (wordObj, query) => {
    if (!query) return true;
    const lowerQuery = query.toLowerCase();
    const tayal = (wordObj.name || '').toLowerCase();
    const defins = wordObj.explanationItems || [];
    const ch = defins.length > 0 ? (defins[0].chineseExplanation || '').toLowerCase() : '';

    return (
      tayal.includes(lowerQuery) ||
      ch.includes(lowerQuery) ||
      defins.some(def => (def.chineseExplanation || '').toLowerCase().includes(lowerQuery))
    );
  };
  
  const filterAndSort = (contentIds, state, selectedSubCategory) => {
    return allWords
      .filter(w => {
        const tayal = (w.name || '').toLowerCase();
        const matchId = contentIds.includes(w.name);
        const matchLetter = !state.filterLetter || tayal.startsWith(state.filterLetter);
        const fre=w.frequency || '';
        let starCount = 0;
        if (fre >= 0 && fre <= 50) starCount = 1;
        else if (fre <= 400) starCount = 2;
        else if (fre <= 800) starCount = 3;
        else if (fre <= 1000) starCount = 4;
        else starCount = 5;
        const matchFreq = !state.frequencyFilter || starCount === parseInt(state.frequencyFilter);
        const matchQuery = matchSearchCriteria(w, state.activeQuery);

        const matchesCategory =
          !selectedSubCategory ||
          (w.explanationItems?.some(def => def.category?.includes(selectedSubCategory)) ||
          w.category === selectedSubCategory);

        return matchId && matchLetter && matchFreq && matchQuery && matchesCategory;
      })
      .sort((a, b) => {
        const aFirst = (a.name || '').toLowerCase();
        const bFirst = (b.name || '').toLowerCase();

        
        const aInitial = aFirst[0] || '';
        const bInitial = bFirst[0] || '';

        if (state.sortOrder === 'asc') {
          // 升冪：A → Z → '
          if (aInitial === "'" && bInitial !== "'") return 1;
          if (aInitial !== "'" && bInitial === "'") return -1;
          return aFirst.localeCompare(bFirst);
        } else {
          // 降冪：' → Z → A
          if (aInitial === "'" && bInitial !== "'") return -1;
          if (aInitial !== "'" && bInitial === "'") return 1;
          return bFirst.localeCompare(aFirst);
        }
      });
  };

  return filterAndSort;
};

const App = () => {
  const [user, setUser] = useState(null);
  const [favorites, setFavorites] = useState([]);
  const [activeTab, setActiveTab] = useState(1);
  const [allWords, setAllWords] = useState([]);
  const [expandedWord, setExpandedWord] = useState(null);
  const [audio, setAudio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [delayedCheck, setDelayedCheck] = useState(false);
  const toggleExpand = (key) => setExpandedWord(prev => (prev === key ? null : key));

  const [tabStates, updateTabState] = useTabState(favorites);
  const filterAndSort = useFilterAndSort(allWords);

  const location = useLocation();
  
  const [isMobile, setIsMobile] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [activeTabcat, setActiveTabcat] = useState('語法與功能');
  const [selectedSubCategory, setSelectedSubCategory] = useState(null)
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  
  const excludedLetters = ['d', 'f', 'j', 'v'];
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)).concat("'").filter(l => !excludedLetters.includes(l));

  useEffect(() => {
      const checkScreenSize = () => {
        setIsMobile(window.innerWidth < 768);
      };
      checkScreenSize();
      window.addEventListener('resize', checkScreenSize);
      return () => window.removeEventListener('resize', checkScreenSize);
    }, []);
  useEffect(() => {
    if (location.state?.tabId) {
      setActiveTab(location.state.tabId);
    }
  }, [location.state]);
  useEffect(() => {
    setLoading(true);
    axios.post(import.meta.env.VITE_API_SEARCH_ALL_URL)
      .then(res => {
        setAllWords(Object.values(res.data.all_results).flat());
        setLoading(false);
      })
      .catch(err => {
        console.error("載入單字失敗：", err);
        setLoading(false);
      });

    const unsubscribe = authChanges((userData) => {
      if (userData) {
        setUser(userData);
        setFavorites(userData.firestoreData.favorites || []);
      }
    });

    const timer = setTimeout(() => setDelayedCheck(true), 1500);

    return () => {
      unsubscribe();
      clearTimeout(timer);
      if (audio) audio.pause();
    };
  }, []);

  const playAudio = async (fileId) => {
    if (!fileId) return;


    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }


    const proxyUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL + fileId;
    const newAudio = new Audio(proxyUrl);

    newAudio.play().catch(err => console.error("播放失敗:", err));
    setAudio(newAudio);
  };

  const toggleFavorite = async (wordTayal, categoryId) => {
    try {
      const updatedFavorites = favorites.map(fav => {
        if (fav.id !== categoryId) return fav;

        const exists = fav.content.includes(wordTayal);
        const newContent = exists
          ? fav.content.filter(w => w !== wordTayal)
          : [...fav.content, wordTayal];

        return { ...fav, content: newContent };
      });

      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { favorites: updatedFavorites });
      setFavorites(updatedFavorites);
    } catch (err) {
      console.error("收藏操作失敗：", err);
    }
  };

  if (!user && delayedCheck) return <PermissionProtect />;

  const currentTab = favorites.find(t => t.id === activeTab);
  const currentState = tabStates[activeTab] || {};
  const filteredWords = currentTab ? filterAndSort(currentTab.content, currentState, selectedSubCategory) : [];

  return (
    <Container className="p-2 word-library-container">
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 900,
          backgroundColor: 'white',
          paddingTop: '1rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid #e5e7eb'
        }}
      >
        <h2 className="fw-bold d-flex align-items-center mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="currentColor" className="bi bi-heart me-2" viewBox="0 0 16 16">
            <path d="M8 2.748L7.283 2.01C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 3.905C2.634 8.313 4.548 10.13 8 12.343c3.452-2.213 5.365-4.03 6.286-5.385.955-1.405.838-2.882.314-3.905C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171.057-.059.116-.115.176-.17C12.72-3.042 23.333 4.867 8 15z" />
          </svg>
          個人詞語庫
        </h2>
        
        {/* <Tabs
          activeKey={activeTab}
          onSelect={(k) => setActiveTab(parseInt(k))}
          justify
          className="mb-3"
        >
          {favorites.map(tab => (
            <Tab key={tab.id} eventKey={tab.id} title={tab.title} />
          ))}
        </Tabs> */}

        {currentTab && (
          <SearchAndFilterControls
            tab={currentTab}
            state={currentState}
            onStateChange={(key, value) => updateTabState(activeTab, key, value)}
            alphabet={alphabet}
            isMobile={isMobile}
            activeTabcat={activeTabcat}
            setActiveTabcat={setActiveTabcat}
            showCategories={showCategories}
            setShowCategories={setShowCategories}
            selectedSubCategory={selectedSubCategory}
            setSelectedSubCategory={setSelectedSubCategory}
            showFilterPanel={showFilterPanel}
            setShowFilterPanel={setShowFilterPanel}
          />
        )}
      </div>

      {loading ? (
        <div className="text-center py-5">
          <div className="text-muted">載入中...</div>
        </div>
      ) : (
        <div className="word-cards-grid">
          {filteredWords.map((wordData, idx) => (
            <WordCardWithImg
              key={wordData.name + idx}
              keyName={wordData.name + idx}
              word={wordData.explanationItems?.[0]?.chineseExplanation || wordData.chineseExplanation || ''}
              category={wordData.explanationItems?.[0]?.category || ''}
              result={wordData}
              expandedWord={expandedWord}
              toggleExpand={toggleExpand}
              toggleFavorite={() => toggleFavorite(wordData.name, currentTab.id)}
              playAudio={playAudio}
              isFavorited={currentTab?.content.includes(wordData.name)}
            />
          ))}
        </div>
      )}
    </Container>
  );
};

export default App;