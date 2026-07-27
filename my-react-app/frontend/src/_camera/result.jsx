import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ListGroup, Alert, Spinner, Button,
  Dropdown, Offcanvas
} from 'react-bootstrap';
import { FaChevronDown, FaChevronUp } from "react-icons/fa";
import { auth } from "../../../firebase";
import { useFavorites } from "../../src/userServives/useFavorites";
import ErrorBoundary from "../errorBoundary";
import { Tabs, Tab } from 'react-bootstrap';
import "../../static/css/_camera/result.css";
import { categoryGroups } from "../constants/categoryGroups";
import { filterAndSortWords as sortWords } from "../../utils/wordFilterSort";
import useAudioPlayback from "../_search/hooks/useAudioPlayback";
// 這裡跟 useAudioPlayback 一樣直接吃 _search 頁面的共用元件：原本這裡自己維護
// 一份幾乎相同的 WordCard，缺少 _search 版本後來補上的發音播放／音檔可用性
// 判斷，_search 版本則原本缺少這裡的鍵盤可操作性，兩邊各自修過的東西沒同步，
// 已經悄悄分岔。改成兩邊共用同一份，_search/components/WordCard.jsx 已經
// 補上鍵盤存取支援，欄位、bug 修正只需要改一個地方。
import WordCard from "../_search/components/WordCard";

// 影像辨識精靈第 3 步：查詢辨識出的單詞並顯示完整詞典結果。
// selectedWords/tribe 由 index.jsx（精靈容器）傳入，取代原本從路由 state 讀取；
// onRestart 取代原本「返回 /camera」的導頁，改成重置精靈狀態回到第 1 步。
const CameraResultStep = ({ selectedWords, tribe, onRestart }) => {
  const [definitions, setDefinitions] = useState({ exact_match_results: {}, fuzzy_match_results: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedWord, setExpandedWord] = useState(null);
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterLetter, setFilterLetter] = useState('');
  const { favorites, toggleFavorite, error: favoritesError } = useFavorites();
  const favoriteWords = useMemo(
    () => new Set(favorites.find(fav => fav.id === 1)?.content || []),
    [favorites]
  );
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [frequencyFilter, setFrequencyFilter] = useState('');
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
    // auth.currentUser?.getIdToken() 若 currentUser 是 null 會短路成 undefined，
    // 若直接接在這個 optional chain 後面 .then/.catch/.finally 整條都不會執行，
    // loading 會卡住、也不會顯示任何錯誤。改成 await 包在一個一定會回傳 Promise
    // 的 async function 裡（沿用同層 label.jsx 的 analyze() 寫法），undefined
    // token 只影響要不要帶 Authorization header，不會讓整條鏈路短路。
    const fetchResults = async () => {
      const token = await auth.currentUser?.getIdToken();
      return axios.post(import.meta.env.VITE_API_SEARCH_KEYS_URL, { words: selectedWords, tribe }, {
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
      });
    };

    fetchResults()
      .then(response => {
        setDefinitions({
          exact_match_results: response.data.exact_match_results || {},
          fuzzy_match_results: response.data.fuzzy_match_results || {},
        });
      })
      .catch(err => {
        setError("查詢失敗: " + (err.response?.data?.detail || err.message));
      })
      .finally(() => setLoading(false));
  }, [selectedWords, tribe]);

  const toggleExpand = (key) => setExpandedWord(prev => (prev === key ? null : key));

  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // playAudio 改用 _search 頁面共用的 hook：原本這裡自己維護一份 playAudio，
  // 缺少 hook 版本後來補上的「取消上一次播放的請求」（避免快速連續點擊時舊音檔
  // 蓋掉新音檔）與「失敗音檔追蹤」（播放失敗過的 fileId 不再顯示播放鈕）。
  const { playAudio, failedAudio } = useAudioPlayback(tribe, setError);

  const filterAndSortWords = (words) => sortWords(words, {
    filterLetter, frequencyFilter, showOnlyFavorites, favoriteWords, selectedSubCategory, sortOrder,
  });
  const excludedLetters = ['d', 'f', 'j', 'v'];
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)).concat("'").filter(l => !excludedLetters.includes(l));



  const _exactMatchFilteredCount = Object.values(definitions.exact_match_results).map(arr => filterAndSortWords(arr).length).reduce((a, b) => a + b, 0);
  const _fuzzyMatchFilteredCount = Object.values(definitions.fuzzy_match_results).flatMap(obj => Object.values(obj).map(list => filterAndSortWords(list).length)).reduce((a, b) => a + b, 0);

  return (
    <div className="yy-fade-up camera-step3">
      <div className="camera-step3-header">
        <h2 className="camera-step3-title">查詢結果</h2>
        <button type="button" className="yy-btn-outline" onClick={onRestart}>↺ 重新辨識</button>
      </div>
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

                    
                    <Button  variant="outline-danger" onClick={onRestart}>
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

              <Button className="ms-3" variant="outline-danger" onClick={onRestart}>
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
        className="category-bar yy-card d-flex justify-content-between align-items-center"
        role="button"
        tabIndex={0}
        onClick={() => setShowCategories(!showCategories)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowCategories(!showCategories); } }}
      >
        <span className="fw-bold">📂 單詞分類
          {selectedSubCategory && (
      <span style={{ marginLeft: "8px" }}>
        - <span style={{color: "var(--yy-red)" }}>{selectedSubCategory}</span>
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
      {loading && <Spinner animation="border" variant="primary" />}
      {error && <Alert variant="danger">{error}</Alert>}
      {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}

     
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
                    <ErrorBoundary
                      key={key}
                      fallback={<ListGroup.Item className="text-danger small">這個詞條顯示時發生錯誤。</ListGroup.Item>}
                    >
                      <WordCard
                        keyName={key}
                        word={word}
                        result={wordData}
                        isExpanded={expandedWord === key}
                        toggleExpand={toggleExpand}
                        toggleFavorite={toggleFavorite}
                        wordName={wordData.name}
                        playAudio={playAudio}
                        isFavorited={favoriteWords.has(wordData.name)}
                        failedAudio={failedAudio}
                      />
                    </ErrorBoundary>
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
                      <ErrorBoundary
                        key={key}
                        fallback={<ListGroup.Item className="text-danger small">這個詞條顯示時發生錯誤。</ListGroup.Item>}
                      >
                        <WordCard
                          keyName={key}
                          word={word}
                          result={wordData}
                          isExpanded={expandedWord === key}
                          toggleExpand={toggleExpand}
                          toggleFavorite={toggleFavorite}
                          wordName={wordData.name}
                          playAudio={playAudio}
                          isFavorited={favoriteWords.has(wordData.name)}
                          failedAudio={failedAudio}
                        />
                      </ErrorBoundary>
                );
              })}
            </ListGroup>
          </>
        );
      })()
    }
    </div>
  );
};

export default CameraResultStep;
