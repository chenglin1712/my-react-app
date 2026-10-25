import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Container, Button, Dropdown } from 'react-bootstrap';
import { Link, useLocation } from 'react-router-dom';
import { useFavorites } from "../../src/userServives/useFavorites";
import ErrorBoundary from "../errorBoundary";
import { TRIBES as TRIBE_LIST, TRIBE_NAMES as TRIBES } from "../constants/tribes";
import { apiPost } from "../../utils/apiClient";
import useAudioPlayback from "../../hooks/useAudioPlayback";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useTabState } from "./hooks/useTabState";
import { filterFavoriteWords } from "./filterFavoriteWords";
import WordCardWithImg from "./components/WordCardWithImg";
import SearchAndFilterControls from "./components/SearchAndFilterControls";
import EmptyState from "@components/ui/EmptyState";
import LoadingSpinner from "@components/ui/LoadingSpinner";
import { describeActiveFilters } from "@utils/wordFilterState";
import { deriveInitialLetters } from "@utils/wordLetters";
import "../../static/css/_favorite/index.css"

const PAGE_SIZE = 50;
// 後端 FavoriteCountsRequest.names 的筆數上限
const MAX_SUMMARY_NAMES = 2000;
// 使用者連續取消收藏時等一下再問後端，避免每點一次就打一次（後端每分鐘 30 次）
const SUMMARY_DEBOUNCE_MS = 400;

const FavoritePage = () => {
  // /favorite 已經在 route.jsx 的 <ProtectedLayout> 底下，未登入會由它統一導去
  // PermissionProtect，這裡不需要再重複判斷一次登入狀態。
  const { favorites, toggleFavorite, error: favoritesError } = useFavorites();
  const [activeTab, setActiveTab] = useState(1);
  const [allWords, setAllWords] = useState([]);
  const [expandedWord, setExpandedWord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedTribe, setSelectedTribe] = useState('泰雅');
  // 後端統計的各族語收藏數 { 泰雅: 12, 阿美: 3, ... }；還沒拿到或查詢失敗就是 null（只是少了其他族語的數字，不影響收藏本身）
  // 連同它是哪個收藏分類的統計一起存：切換分類後舊分類的數字不能拿來顯示
  const [tribeCountsState, setTribeCountsState] = useState(null);
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
  }, [selectedTribe, loadAttempt]);

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

  // 開頭字母只列出這個收藏分類裡真的有的字母
  const alphabet = deriveInitialLetters(currentTab ? allWords.filter(w => currentTab.content.includes(w.name)) : []);
  const activeFilterParts = describeActiveFilters({
    filterLetter: currentState.filterLetter,
    frequencyFilter: currentState.frequencyFilter,
    selectedSubCategory,
  });
  const hasSearchQuery = Boolean((currentState.activeQuery || '').trim());
  const clearFilters = () => {
    updateTabState(activeTab, 'filterLetter', '');
    updateTabState(activeTab, 'frequencyFilter', '');
    updateTabState(activeTab, 'activeQuery', '');
    updateTabState(activeTab, 'inputValue', '');
    setSelectedSubCategory(null);
  };

  // 目前族語裡屬於這個收藏分類的詞數：切換族語後使用者容易以為收藏不見了，所以直接寫出來
  const tribeFavoriteCount = currentTab
    ? allWords.filter(w => currentTab.content.includes(w.name)).length
    : 0;

  // 其他族語各收藏幾個詞：收藏只存詞名、不分族語，要請後端對照各族語詞條。
  // 目前選的族語用畫面上實際的字卡數（即時、不必等後端）。
  const summaryNames = currentTab?.content;
  useEffect(() => {
    // 超過後端單次上限就不統計其他族語（寧可不顯示，也不顯示被截斷的不完整數字）
    if (!Array.isArray(summaryNames) || summaryNames.length > MAX_SUMMARY_NAMES) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiPost(import.meta.env.VITE_API_FAVORITES_SUMMARY_URL, { names: summaryNames })
        .then(data => {
          if (cancelled || !data?.counts) return;
          setTribeCountsState({
            tabId: activeTab,
            counts: Object.fromEntries(TRIBE_LIST.map(t => [t.name, data.counts[t.slug] ?? 0])),
          });
        })
        .catch(err => {
          if (!cancelled) console.error("載入各族語收藏數失敗：", err);
        });
    }, SUMMARY_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [summaryNames, activeTab]);

  const tribeCounts = tribeCountsState?.tabId === activeTab ? tribeCountsState.counts : null;

  const countsReady = !loading && !loadError && Boolean(currentTab);
  const countByTribe = tribeCounts
    ? { ...tribeCounts, ...(countsReady ? { [selectedTribe]: tribeFavoriteCount } : {}) }
    : null;
  const otherTribeCounts = countByTribe
    ? TRIBES.filter(t => t !== selectedTribe && countByTribe[t] > 0).map(t => `${t} ${countByTribe[t]}`)
    : [];

  return (
    <div className="yy-page favorite-page">
    <section className="yy-hero favorite-hero">
      <div className="yy-fade-up">
        <h1 className="favorite-title">個人詞語庫</h1>
        <p className="favorite-desc">你收藏的詞會依族語分開顯示，切換族語就能看到其他族語的收藏。</p>
      </div>
    </section>
    <Container className="p-2 word-library-container">
      {/* 頁首不再 sticky：原本 top:0 會被 z-index 1000 的全站導覽列蓋住（審查項 P1-14），改成隨內容捲走，跟辭典頁一致 */}
      <div className="favorite-controls">
        <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
          <Dropdown onSelect={(val) => setSelectedTribe(val)}>
            <Dropdown.Toggle variant="outline-secondary" size="sm">
              族語：{selectedTribe}
            </Dropdown.Toggle>
            <Dropdown.Menu>
              {TRIBES.map(t => (
                <Dropdown.Item key={t} eventKey={t} className="d-flex justify-content-between gap-3">
                  <span>{t}</span>
                  {countByTribe && <span className="favorite-tribe-count">{countByTribe[t]} 個詞</span>}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          {/* live region 常駐，載入完成後只更新文字，報讀器才會可靠唸出 */}
          <span className="favorite-count" role="status">
            {countsReady && `${selectedTribe}族語已收藏 ${tribeFavoriteCount} 個詞`}
            {countsReady && otherTribeCounts.length > 0 && `（其他族語：${otherTribeCounts.join('、')}）`}
          </span>
        </div>

        {currentTab && (
          <SearchAndFilterControls
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

      {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}

      {loading ? (
        <LoadingSpinner label="載入收藏中…" />
      ) : loadError ? (
        <div className="text-center py-5" role="alert">
          <p className="yy-text-danger">單字資料暫時載入失敗，請稍後再試。</p>
          <Button type="button" variant="danger" onClick={() => setLoadAttempt(n => n + 1)}>重試</Button>
        </div>
      ) : (
        <>
          {currentTab && filteredWords.length === 0 && (
            currentTab.content.length === 0 ? (
              <EmptyState
                title="這個分類還沒有收藏的詞"
                actions={<Link to="/search" className="btn btn-danger">去單詞查詢</Link>}
              >
                <p>在單詞查詢找到喜歡的詞，點字卡旁的愛心就會收進來。</p>
              </EmptyState>
            ) : (
              <EmptyState
                title="目前的條件下沒有符合的收藏"
                actions={(hasSearchQuery || activeFilterParts.length > 0) ? (
                  <Button type="button" variant="danger" onClick={clearFilters}>清除搜尋與篩選</Button>
                ) : undefined}
              >
                {(hasSearchQuery || activeFilterParts.length > 0) && (
                  <p>
                    目前的條件：{[hasSearchQuery && `關鍵字「${currentState.activeQuery.trim()}」`, ...activeFilterParts].filter(Boolean).join('、')}。
                  </p>
                )}
              </EmptyState>
            )
          )}
          <div className="word-cards-grid">
            {filteredWords.slice(0, visibleCount).map((wordData, idx) => (
              // 單張字卡渲染出錯時只讓那張卡片顯示錯誤提示，不要讓整個收藏格線消失。
              <div className="word-card-cv" key={wordData.name + idx}>
              <ErrorBoundary
                fallback={<div className="yy-text-danger small p-2">這個詞條顯示時發生錯誤。</div>}
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
              </div>
            ))}
          </div>
          {visibleCount < filteredWords.length && (
            <div className="text-center my-3">
              <Button type="button" variant="outline-danger" className="yy-btn-touch" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
                載入更多（剩 {filteredWords.length - visibleCount} 筆）
              </Button>
            </div>
          )}
        </>
      )}
    </Container>
    </div>
  );
};

export default FavoritePage;
