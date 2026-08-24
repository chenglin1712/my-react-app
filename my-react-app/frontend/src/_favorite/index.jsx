import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Container, Button, Dropdown } from 'react-bootstrap';
import { useLocation } from 'react-router-dom';
import { useFavorites } from "../../src/userServives/useFavorites";
import ErrorBoundary from "../errorBoundary";
import { TRIBE_NAMES as TRIBES } from "../constants/tribes";
import { apiPost } from "../../utils/apiClient";
import useAudioPlayback from "../../hooks/useAudioPlayback";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useTabState } from "./hooks/useTabState";
import { filterFavoriteWords } from "./filterFavoriteWords";
import WordCardWithImg from "./components/WordCardWithImg";
import SearchAndFilterControls from "./components/SearchAndFilterControls";
import "../../static/css/_favorite/index_judy.css"

const PAGE_SIZE = 50;
const EXCLUDED_LETTERS = ['d', 'f', 'j', 'v'];
const ALPHABET = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i))
  .concat("'")
  .filter(l => !EXCLUDED_LETTERS.includes(l));

const FavoritePage = () => {
  // /favorite 已經在 route.jsx 的 <ProtectedLayout> 底下，未登入會由它統一導去
  // PermissionProtect，這裡不需要再重複判斷一次登入狀態。
  const { favorites, toggleFavorite, error: favoritesError } = useFavorites();
  const [activeTab, setActiveTab] = useState(1);
  const [allWords, setAllWords] = useState([]);
  const [expandedWord, setExpandedWord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedTribe, setSelectedTribe] = useState('泰雅');
  const toggleExpand = useCallback((key) => setExpandedWord(prev => (prev === key ? null : key)), []);

  const [tabStates, updateTabState] = useTabState(favorites);
  const { playAudio, failedAudio } = useAudioPlayback(selectedTribe);

  const location = useLocation();

  const isMobile = useIsMobile();
  const [showCategories, setShowCategories] = useState(false);
  const [activeTabcat, setActiveTabcat] = useState('語法與功能');
  const [selectedSubCategory, setSelectedSubCategory] = useState(null)
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // 快速切換族語時，比較慢的舊查詢可能在新族語的結果顯示之後才回來，蓋掉
  // 新族語已經顯示的單字。
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    if (location.state?.tabId) {
      setActiveTab(location.state.tabId);
    }
  }, [location.state]);

  // 依目前選擇的族語重新查詢單字，避免一次載入不相關族語的全部資料
  useEffect(() => {
    const myGeneration = ++requestGenerationRef.current;
    setLoading(true);
    setLoadError(false);
    // apiPost 內部一定會回傳 Promise（即使 auth.currentUser 是 null，token 只影響
    // 要不要帶 Authorization header），不會有「未登入時整條 .then/.catch 都不執行、
    // loading 卡住」的問題。
    apiPost(import.meta.env.VITE_API_SEARCH_ALL_URL, { tribe: selectedTribe })
      .then(data => {
        if (myGeneration !== requestGenerationRef.current) return;
        setAllWords(Object.values(data.all_results || {}).flat());
        setLoading(false);
      })
      .catch(err => {
        if (myGeneration !== requestGenerationRef.current) return;
        console.error("載入單字失敗：", err);
        setLoadError(true);
        setLoading(false);
      });
  }, [selectedTribe]);

  const currentTab = favorites.find(t => t.id === activeTab);
  const currentState = tabStates[activeTab] || {};

  // 換分類、族語或篩選條件變動時，分頁顯示筆數重置回第一頁——只依賴真正會
  // 影響結果的欄位，不要整包 state stringify（inputValue 每打一個字就變，
  // 但真正套用的搜尋字是 activeQuery，不該打字就重置分頁）。
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [
    activeTab, selectedTribe, selectedSubCategory,
    currentState.activeQuery, currentState.sortOrder, currentState.filterLetter, currentState.frequencyFilter,
  ]);

  const filteredWords = currentTab
    ? filterFavoriteWords(allWords, currentTab.content, currentState, selectedSubCategory)
    : [];

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

        <Dropdown className="mb-3" onSelect={(val) => setSelectedTribe(val)}>
          <Dropdown.Toggle variant="outline-secondary" size="sm">
            族語：{selectedTribe}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {TRIBES.map(t => (
              <Dropdown.Item key={t} eventKey={t}>{t}</Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown>

        {currentTab && (
          <SearchAndFilterControls
            state={currentState}
            onStateChange={(key, value) => updateTabState(activeTab, key, value)}
            alphabet={ALPHABET}
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

      {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}

      {loading ? (
        <div className="text-center py-5">
          <div className="text-muted">載入中...</div>
        </div>
      ) : loadError ? (
        <div className="text-center py-5 text-danger">
          單字資料載入失敗，請重新整理頁面再試一次。
        </div>
      ) : (
        <>
          <div className="word-cards-grid">
            {filteredWords.slice(0, visibleCount).map((wordData, idx) => (
              // 單張字卡渲染出錯時只讓那張卡片顯示錯誤提示，不要讓整個收藏格線消失。
              <ErrorBoundary
                key={wordData.name + idx}
                fallback={<div className="text-danger small p-2">這個詞條顯示時發生錯誤。</div>}
              >
                <WordCardWithImg
                  keyName={wordData.name + idx}
                  word={wordData.explanationItems?.[0]?.chineseExplanation || wordData.chineseExplanation || ''}
                  result={wordData}
                  isExpanded={expandedWord === wordData.name + idx}
                  toggleExpand={toggleExpand}
                  toggleFavorite={toggleFavorite}
                  wordName={wordData.name}
                  categoryId={currentTab.id}
                  playAudio={playAudio}
                  failedAudio={failedAudio}
                  isFavorited={currentTab.content.includes(wordData.name)}
                />
              </ErrorBoundary>
            ))}
          </div>
          {visibleCount < filteredWords.length && (
            <div className="text-center my-3">
              <Button type="button" variant="outline-danger" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
                載入更多（剩 {filteredWords.length - visibleCount} 筆）
              </Button>
            </div>
          )}
        </>
      )}
    </Container>
  );
};

export default FavoritePage;
