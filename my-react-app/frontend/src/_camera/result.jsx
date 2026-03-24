import { useEffect, useState } from "react";
import { useLocation , useNavigate } from "react-router-dom";
import axios from "axios";
import {
  Container, ListGroup, Alert, Spinner, Button,
  Dropdown, DropdownButton, Offcanvas
} from 'react-bootstrap';
import { FaHeart, FaRegHeart, FaPlayCircle, FaChevronDown, FaChevronUp } from "react-icons/fa";
import { toggleFavoriteWord, authChanges } from "../../src/userServives/userServive";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../firebase";
import { Tabs, Tab, Row, Col } from 'react-bootstrap';
import "../../static/css/_camera/result.css"; 

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

const renderStars = (fre) => {
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

const WordCard = ({ word, result, keyName, expandedWord, toggleExpand, toggleFavorite, playAudio, isFavorited }) => (
  <ListGroup.Item key={keyName} className="d-flex flex-column">
    <div className="d-flex justify-content-between align-items-center">
      <div onClick={() => toggleExpand(keyName)} style={{ cursor: 'pointer', flex: 1 }}>
        <h3 className="fw-bolder text-danger">
          {result.name || '無資料'}
          {result.audioItems.length!=0?  (
            <Button variant="link" onClick={(e) => { e.stopPropagation(); if (result.audioItems?.length) playAudio(result.audioItems[0].fileId); }}>
              <FaPlayCircle size={20} className="text-warning" />
            </Button>
          ):(<></>)}
        </h3>
        <h5 className="fw-bolder">{word}</h5>
      </div>
      <Button variant="link" onClick={() => toggleFavorite(keyName)}>
        {isFavorited ? <FaHeart color="red" /> : <FaRegHeart color="black" />}
      </Button>
    </div>
    {expandedWord === keyName && (
      <div className="mt-2 pt-2 border-top">
        <ListGroup variant="flush">
          {result.frequency?<ListGroup.Item><strong>詞頻：</strong>{renderStars(result.frequency)}</ListGroup.Item>:<></>}
          {result.sources?<ListGroup.Item><strong>收錄來源：</strong>{Array.isArray(result.sources) ? result.sources.join('、') : result.sources || ''}</ListGroup.Item>:<></>}
          {result.variant?<ListGroup.Item><strong>異體詞：</strong>{result.variant || ''}</ListGroup.Item>:<></>}
          {result.formationWord?<ListGroup.Item><strong>構詞：</strong>{result.formationWord || ''}</ListGroup.Item>:<></>}
          {result.derivativeRoot?<ListGroup.Item><strong>衍生詞根：</strong>{result.derivativeRoot || ''}</ListGroup.Item>:<></>}
          {result.dictionaryNote.replace(/[\r\n]+/g, '')?<ListGroup.Item><strong>備註：</strong>{result.dictionaryNote || ''}</ListGroup.Item>:<></>}
          {result.explanationItems?.map((def, i) => (
            <ListGroup.Item key={i}>
              <h5 className="fw-bolder">{def.chineseExplanation || ''}  {def.englishExplanation || ''}</h5>           
              {def.category && def.category.length > 0 ?<h6><strong>分類：</strong>{def.category || ''}</h6>:<></>}
              {def.partOfSpeech&& def.partOfSpeech.length > 0?<h6><strong>詞性：</strong>{def.partOfSpeech || ''}</h6>:<></>}
              {def.focus&& def.focus.length > 0?<h6><strong>焦點：</strong>{def.focus || ''}</h6>:<></>}
              {def.sentenceItems?.map((ex, ei) => {
                const hasText = ex.originalSentence?.trim() || ex.chineseSentence?.trim();
                if (!hasText) return null;
                return (
                  <ListGroup.Item key={`${i}-${ei}`}>
                    <h6 className="fw-bolder text-danger">
                      {ex.originalSentence}
                      {ex.audioItems.length!=0? (
                        <Button variant="link" onClick={() => {if (ex.audioItems?.length) playAudio(ex.audioItems[0].fileId);}}>
                          <FaPlayCircle size={20} className="text-warning" />
                        </Button>
                      ):(<></>)}
                    </h6>
                    <h6 className="fw-bolder">{ex.chineseSentence}</h6>
                    <h6 className="fw-bolder">{ex.englishSentence || ''}</h6>
                  </ListGroup.Item>
                );
              })}
            </ListGroup.Item>
          ))}
        </ListGroup>
      </div>
    )}
  </ListGroup.Item>
);

const App = () => {
  const [query, setQuery] = useState('');
  const location = useLocation();
  const selectedWords = location.state?.selectedWords || [];

  const [definitions, setDefinitions] = useState({ exact_match_results: {}, fuzzy_match_results: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedWord, setExpandedWord] = useState(null);
  const [favoriteWords, setFavoriteWords] = useState(new Set());
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterLetter, setFilterLetter] = useState('');
  const [audio, setAudio] = useState(null);
  const [user, setUser] = useState(null);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [frequencyFilter, setFrequencyFilter] = useState('');
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [activeTab, setActiveTab] = useState('語法與功能');
  const [selectedSubCategory, setSelectedSubCategory] = useState(null)
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  useEffect(() => {
    if (selectedWords.length === 0) {
      setError("請選擇至少一個單詞！");
      return;
    }

    setLoading(true);
    axios.post(import.meta.env.VITE_API_SEARCH_KEYS_URL, { words: selectedWords })
      .then(response => {
        setDefinitions({
          exact_match_results: response.data.exact_match_results || {},
          fuzzy_match_results: response.data.fuzzy_match_results || {},
        });
      })
      .catch(err => {
        setError("查詢失敗: " + (err.response?.data?.error || err.message));
      })
      .finally(() => setLoading(false));
  }, [selectedWords]);

  const toggleExpand = (key) => setExpandedWord(prev => (prev === key ? null : key));

  const toggleFavorite = async (wordTayal) => {
    if (!user) return;
  setFavoriteWords(prev => {
    const newSet = new Set(prev);
    if (newSet.has(wordTayal)) {
      newSet.delete(wordTayal);
    } else {
      newSet.add(wordTayal);
    }
    return newSet;
  });

  
    try {
      
      const baseCategory = user.firestoreData.favorites.find(fav => fav.id === 1);
      let newContent = baseCategory?.content || [];

      if (newContent.includes(wordTayal)) {
    
        newContent = newContent.filter(w => w !== wordTayal);
      } else {
      
        newContent = [...newContent, wordTayal];
      }

     
      await updateUserFavoritesCategory(user.uid, 1, newContent);

      setUser(prevUser => {
        if (!prevUser) return prevUser;
        const newFavorites = prevUser.firestoreData.favorites.map(fav => {
          if (fav.id === 1) {
            return { ...fav, content: newContent };
          }
          return fav;
        });
        return { ...prevUser, 
          firestoreData: {
          ...prevUser.firestoreData,
          favorites: newFavorites
          } 
        };
      });
    } catch (err) {
      console.error('同步收藏失敗', err);
    }
  
};

async function updateUserFavoritesCategory(userId, categoryId, newContent) {
  const userDocRef = doc(db, "users", userId);

  const userSnap = await getDoc(userDocRef);
  if (!userSnap.exists()) throw new Error("使用者文件不存在");

  const userData = userSnap.data();
  const favorites = userData.favorites || [];

  const newFavorites = favorites.map(fav => {
    if (fav.id === categoryId) {
      return { ...fav, content: newContent };
    }
    return fav;
  });

  await updateDoc(userDocRef, { favorites: newFavorites });
}
useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem('favoriteWords');
    if (saved) setFavoriteWords(new Set(JSON.parse(saved)));
    
    const unsubscribe = authChanges(async (userData) => {
      //console.log("authChanges 回傳:", userData);
      if (userData) {
        setUser(userData);
        const baseCategory = userData.firestoreData.favorites.find(fav => fav.id === 1);
        const favoriteSet = new Set(baseCategory?.content || []);
        setFavoriteWords(favoriteSet);
      } else {
        setUser(null);
        setFavoriteWords(new Set());
      }
    });
    return () => unsubscribe();
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


  const filterAndSortWords = (words) => {
    return words
      .filter(w => {
        const tayal = (w.name || '').toLowerCase();
        const matchesLetter = !filterLetter || tayal.startsWith(filterLetter);
        const isFavorite = favoriteWords.has(w.name);

        const fre = w.frequency || '';
        let starCount = 0;
        if (fre >= 0 && fre <= 200) starCount = 1;
        else if (fre <= 400) starCount = 2;
        else if (fre <= 800) starCount = 3;
        else if (fre <= 1000) starCount = 4;
        else starCount = 5;
        const matchesFrequency = !frequencyFilter || starCount === parseInt(frequencyFilter);

        const matchesCategory =
          !selectedSubCategory ||
          (w.explanationItems?.some(def => def.category?.includes(selectedSubCategory)) ||
          w.category === selectedSubCategory);

        return matchesLetter && (!showOnlyFavorites || isFavorite) && matchesFrequency && matchesCategory;
      })
      .sort((a, b) => {
        const aFirst = (a.name || '').toLowerCase();
        const bFirst = (b.name || '').toLowerCase();

        
        const aInitial = aFirst[0] || '';
        const bInitial = bFirst[0] || '';

        if (sortOrder === 'asc') {
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
  const excludedLetters = ['d', 'f', 'j', 'v'];
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)).concat("'").filter(l => !excludedLetters.includes(l));



  const exactMatchFilteredCount = Object.values(definitions.exact_match_results).map(arr => filterAndSortWords(arr).length).reduce((a, b) => a + b, 0);
  const fuzzyMatchFilteredCount = Object.values(definitions.fuzzy_match_results).flatMap(obj => Object.values(obj).map(list => filterAndSortWords(list).length)).reduce((a, b) => a + b, 0);

  return (
    <Container className="p-4">
      <div style={{ 
        position: 'sticky', 
        top: 0, 
        background: 'white', 
        zIndex: 900, 
        paddingBottom: '1rem', 
        marginBottom: '1rem', 
        borderBottom: '1px solid #ccc' 
      }}>
        <br />
      <h2 className="fw-bolder center" style={{ display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', marginBottom: 0 }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" fill="currentColor" className="bi bi-search" viewBox="0 0 16 16">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
        </svg>&nbsp; 查詢結果
      </h2>
      <br />
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

                    
                    <Button  variant="outline-danger" onClick={() => navigate("/camera")}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-arrow-return-left" viewBox="0 0 16 16">
                        <path fillRule="evenodd" d="M14.5 1.5a.5.5 0 0 1 .5.5v4.8a2.5 2.5 0 0 1-2.5 2.5H2.707l3.347 3.346a.5.5 0 0 1-.708.708l-4.2-4.2a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 8.3H12.5A1.5 1.5 0 0 0 14 6.8V2a.5.5 0 0 1 .5-.5" />
                      </svg>
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

              <Button className="ms-3" variant="outline-danger" onClick={() => navigate("/camera")}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-arrow-return-left" viewBox="0 0 16 16">
                        <path fillRule="evenodd" d="M14.5 1.5a.5.5 0 0 1 .5.5v4.8a2.5 2.5 0 0 1-2.5 2.5H2.707l3.347 3.346a.5.5 0 0 1-.708.708l-4.2-4.2a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 8.3H12.5A1.5 1.5 0 0 0 14 6.8V2a.5.5 0 0 1 .5-.5" />
                      </svg>
                      &nbsp; 返回
                    </Button>
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
      </div>
      {loading && <Spinner animation="border" variant="primary" />}
      {error && <Alert variant="danger">{error}</Alert>}
      
     
      <br />
      {Object.keys(definitions.exact_match_results).length > 0 && (() => {
       
          const allWordsFlat = Object.values(definitions.exact_match_results).flat();
          const filteredSorted = filterAndSortWords(allWordsFlat);
          return (            
              <>
                 <h4 className="fw-bold text-success">完全匹配結果 ({filteredSorted.length})</h4>
                 <ListGroup>
                 {filteredSorted.map((wordData, idx) => {
                const word = wordData.explanationItems?.[0]?.chineseExplanation || wordData.chineseExplanation || '';
                const key = `${word}-${idx}-${wordData.name || ''}`;
                  return (
                    <WordCard
                      key={key}
                      keyName={key}
                      word={word}
                      result={wordData}
                      expandedWord={expandedWord}
                      toggleExpand={toggleExpand}
                      toggleFavorite={() =>toggleFavorite(wordData.name)}
                      playAudio={playAudio}
                      isFavorited={favoriteWords.has(wordData.name)}
                    />
                  );
              })}
            </ListGroup>
          </>
        );
      })()}
      <br />
      {Object.keys(definitions.fuzzy_match_results).length > 0 && (() => {
        
         const allWordsFlat = Object.values(definitions.fuzzy_match_results)
     .flatMap(wordGroup => Object.values(wordGroup).flat());
        const filteredSorted = filterAndSortWords(allWordsFlat);
        return (
          <>  
          <h4 className="fw-bold text-warning">相關匹配結果 ({filteredSorted.length})</h4>
          <ListGroup>
              {filteredSorted.map((wordData, idx) => {
                const word = wordData.explanationItems?.[0]?.chineseExplanation || wordData.chineseExplanation || '';
                const key = `${word}-${idx}-${wordData.name || ''}`;
                  
                    return (
                      <WordCard
                        key={key}
                        keyName={key}
                        word={word}
                        result={wordData}
                        expandedWord={expandedWord}
                        toggleExpand={toggleExpand}
                        toggleFavorite={() =>toggleFavorite(wordData.name)}
                        playAudio={playAudio}
                        isFavorited={favoriteWords.has(wordData.name)}
                      />
                );
              })}
            </ListGroup>
          </>
        );
      })()
    }
    </Container>
  );
};

export default App;
