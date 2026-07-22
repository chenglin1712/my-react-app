import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  ListGroup, Alert, Spinner, Button,
  Dropdown, Offcanvas
} from 'react-bootstrap';
import { FaHeart, FaRegHeart, FaPlayCircle, FaChevronDown, FaChevronUp } from "react-icons/fa";
import { auth } from "../../../firebase";
import { useFavorites } from "../../src/userServives/useFavorites";
import ErrorBoundary from "../errorBoundary";
import { Tabs, Tab } from 'react-bootstrap';
import "../../static/css/_camera/result.css";
import { categoryGroups } from "../constants/categoryGroups";
import { filterAndSortWords as sortWords } from "../../utils/wordFilterSort";
import useAudioPlayback from "../_search/hooks/useAudioPlayback";

const renderStars = (fre) => {
 if (fre === null || fre === undefined) return null;
  let starCount = 0;
  if (fre >= 0 && fre <= 200) starCount = 1;
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

const WordCard = ({ word, result, keyName, expandedWord, toggleExpand, toggleFavorite, playAudio, isFavorited, failedAudio }) => (
  <ListGroup.Item key={keyName} className="d-flex flex-column">
    <div className="d-flex justify-content-between align-items-center">
      <div
        onClick={() => toggleExpand(keyName)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(keyName); } }}
        style={{ cursor: 'pointer', flex: 1 }}
      >
        <h3 className="fw-bolder text-danger">
          {result.name || '無資料'}
          {result.audioItems?.length && !failedAudio?.has(result.audioItems[0].fileId) ? (
            <Button variant="link" aria-label="播放音訊" onClick={(e) => { e.stopPropagation(); playAudio(result.audioItems[0].fileId); }}>
              <FaPlayCircle size={20} className="text-warning" />
            </Button>
          ) : (<></>)}
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
          {result.dictionaryNote?.replace(/[\r\n]+/g, '') ? <ListGroup.Item><strong>備註：</strong>{result.dictionaryNote}</ListGroup.Item> : <></>}
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
                      {ex.audioItems?.length && !failedAudio?.has(ex.audioItems[0].fileId) ? (
                        <Button variant="link" aria-label="播放音訊" onClick={() => playAudio(ex.audioItems[0].fileId)}>
                          <FaPlayCircle size={20} className="text-warning" />
                        </Button>
                      ) : (<></>)}
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
                        expandedWord={expandedWord}
                        toggleExpand={toggleExpand}
                        toggleFavorite={() =>toggleFavorite(wordData.name)}
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
                          expandedWord={expandedWord}
                          toggleExpand={toggleExpand}
                          toggleFavorite={() =>toggleFavorite(wordData.name)}
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
