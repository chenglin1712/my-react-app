import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Container, Alert, Spinner, Button } from 'react-bootstrap';
import { useFavorites } from "../../src/userServives/useFavorites";
import { TRIBE_NAMES, TRIBE_SLUG_BY_NAME } from "../constants/tribes";
import { apiPost } from "../../utils/apiClient";
import { filterAndSortWords as sortWords } from "../../utils/wordFilterSort";
import { useTranslateCapabilities } from "../../hooks/useTranslateCapabilities";
import { useIsMobile } from "../../hooks/useIsMobile";
import "../../static/css/_search/index.css";

import SearchHeader from './components/SearchHeader';
import WordResultsSection from './components/WordResultsSection';
import useAudioPlayback from '../../hooks/useAudioPlayback';

const PAGE_SIZE = 50;
const WORD_FAVORITES_CATEGORY_ID = 1;
const EXCLUDED_LETTERS = ['d', 'f', 'j', 'v'];
const ALPHABET = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i))
  .concat("'")
  .filter(l => !EXCLUDED_LETTERS.includes(l));

const SearchPage = () => {
  const [query, setQuery] = useState('');
  const [definitions, setDefinitions] = useState({ exact_match_results: {}, fuzzy_match_results: {} });
  // 「全部詞條」的篩選／排序／分頁現在都在後端做（見 search_all），
  // allWords 是目前已載入的頁面資料（累積），allTotal 是後端算出的篩選後總筆數
  const [allWords, setAllWords] = useState([]);
  const [allTotal, setAllTotal] = useState(0);
  const [allOffset, setAllOffset] = useState(0);
  const [loadingMoreAll, setLoadingMoreAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedWord, setExpandedWord] = useState(null);
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterLetter, setFilterLetter] = useState('');
  const { favorites, toggleFavorite, error: favoritesError } = useFavorites();
  const favoriteWords = useMemo(
    () => new Set(favorites.find(fav => fav.id === WORD_FAVORITES_CATEGORY_ID)?.content || []),
    [favorites]
  );
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [frequencyFilter, setFrequencyFilter] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const isMobile = useIsMobile();
  const [visibleExactCount, setVisibleExactCount] = useState(PAGE_SIZE);
  const [visibleFuzzyCount, setVisibleFuzzyCount] = useState(PAGE_SIZE);
  const [showCategories, setShowCategories] = useState(false);
  const [activeTab, setActiveTab] = useState('語法與功能');
  const [selectedSubCategory, setSelectedSubCategory] = useState(null);
  const [selectedTribe, setSelectedTribe] = useState('泰雅');

  const { playAudio, playSentence, failedAudio } = useAudioPlayback(selectedTribe, setError);

  // 句子 TTS 備用播放鈕只在這個族語沒有整句真人原音時才需要，跟 _translate
  // 頁面用同一份後端能力資料判斷（見 WordCard.jsx），不再寫死「布農語／排灣語」。
  const capabilities = useTranslateCapabilities();
  const hasSentenceAudio = useMemo(() => {
    const slug = TRIBE_SLUG_BY_NAME[selectedTribe];
    return capabilities?.find(c => c.tribeSlug === slug)?.hasSentenceAudio ?? false;
  }, [capabilities, selectedTribe]);

  const tribes = TRIBE_NAMES;

  const toggleExpand = useCallback((key) => setExpandedWord(prev => (prev === key ? null : key)), []);

  // 目前資料庫已有資料的族語跟支援的族語清單相同，用同一份共用清單；未來若新增
  // 族語但辭典資料還沒建好，這裡可以改成 TRIBE_NAMES 的子集合。
  const TRIBES_WITH_DATA = TRIBE_NAMES;

  // 快速切換族語/篩選條件時，比較慢的舊主查詢可能在新條件的結果顯示之後才回來；
  // requestGenerationRef 讓過期的回應（包含過期的「載入更多」）不再更新畫面。
  // loadingMoreLockRef 是另一件事——擋同一次主查詢底下「載入更多」被同時點兩下，
  // 用 ref 而不是 state，兩次點擊在同一個 tick 內也擋得住。
  const requestGenerationRef = useRef(0);
  const loadingMoreLockRef = useRef(false);

  // 「全部詞條」瀏覽（沒有輸入關鍵字）：字母／詞頻／分類／收藏篩選與排序都交給後端做，
  // 這裡只帶目前的篩選條件 + limit/offset 向 /dictionary/all/ 要一頁資料。純粹負責
  // 查詢，不自己碰 state——generation 檢查與 setState 都交給呼叫端。
  const fetchAllWordsPage = async (tribe, offset) => {
    const body = { tribe, limit: PAGE_SIZE, offset, sort_order: sortOrder };
    if (filterLetter) body.letter = filterLetter;
    if (frequencyFilter) body.frequency = parseInt(frequencyFilter, 10);
    if (selectedSubCategory) body.category = selectedSubCategory;
    if (showOnlyFavorites) {
      body.favorites_only = true;
      body.favorite_names = Array.from(favoriteWords);
    }
    const data = await apiPost(import.meta.env.VITE_API_SEARCH_ALL_URL, body);
    const pageWords = Object.values(data.all_results || {}).flat();
    return { pageWords, total: data.total ?? pageWords.length };
  };

  const handleLoadMoreAll = async () => {
    if (loadingMoreLockRef.current) return;
    loadingMoreLockRef.current = true;
    setLoadingMoreAll(true);
    const myGeneration = requestGenerationRef.current;
    try {
      const { pageWords, total } = await fetchAllWordsPage(selectedTribe, allOffset);
      if (myGeneration !== requestGenerationRef.current) return; // 主查詢已經換過了，這批不算數
      setAllWords(prev => [...prev, ...pageWords]);
      setAllTotal(total);
      setAllOffset(offset => offset + pageWords.length);
    } catch (e) {
      if (myGeneration !== requestGenerationRef.current) return;
      console.error('載入更多失敗:', e);
      setError('載入更多失敗，請稍後再試。');
    } finally {
      loadingMoreLockRef.current = false;
      setLoadingMoreAll(false);
    }
  };

  const handleSearch = async (tribeOverride = null) => {
    // 遞增 generation：任何還在跑的舊主查詢或它底下的「載入更多」都不再算數。
    const myGeneration = ++requestGenerationRef.current;
    const tribe = tribeOverride ?? selectedTribe;
    if (!TRIBES_WITH_DATA.includes(tribe)) {
      setDefinitions({ exact_match_results: {}, fuzzy_match_results: {} });
      setAllWords([]); setAllTotal(0); setAllOffset(0);
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (query.trim() === '') {
        const { pageWords, total } = await fetchAllWordsPage(tribe, 0);
        if (myGeneration !== requestGenerationRef.current) return;
        setAllWords(pageWords);
        setAllTotal(total);
        setAllOffset(pageWords.length);
        setDefinitions({ exact_match_results: {}, fuzzy_match_results: {} });
      } else {
        const data = await apiPost(import.meta.env.VITE_API_SEARCH_KEY_URL, { keyword: query.trim(), tribe });
        if (myGeneration !== requestGenerationRef.current) return;
        setDefinitions({
          exact_match_results: Array.isArray(data.exact_match_results) ? { [query.trim()]: data.exact_match_results } : data.exact_match_results,
          fuzzy_match_results: data.fuzzy_match_results || {},
        });
        setAllWords([]); setAllTotal(0); setAllOffset(0);
      }
    } catch (e) {
      if (myGeneration !== requestGenerationRef.current) return;
      console.error('查詢失敗:', e);
      setError('查詢失敗，請稍後再試。');
    } finally {
      if (myGeneration === requestGenerationRef.current) setLoading(false);
    }
  };

  // handleSearch 每次渲染都重新建立，下面幾個 effect 只想在特定條件變動時呼叫
  // 「當下最新版」的 handleSearch，不想因為 handleSearch 本身參照變了就多重新
  // 執行一次（那會跟 loading/allOffset 等它自己會更新的狀態形成循環）。用一個
  // ref 保存最新版本，effect 依賴列表只放真正要反應的條件，不用再關掉
  // exhaustive-deps 檢查。
  const handleSearchRef = useRef(handleSearch);
  useEffect(() => {
    handleSearchRef.current = handleSearch;
  });
  // 同理，下面兩個 effect 內的 query.trim() === ''／showOnlyFavorites 只是判斷
  // 「現在要不要真的觸發查詢」的 guard，不是它們要反應的觸發條件（showOnlyFavorites
  // 本身變動已經由上一個 effect 的依賴陣列處理，這裡如果也放進依賴陣列，切換「只顯示
  // 收藏」時會兩個 effect 各打一次、變成重複請求），一樣用 ref 讀最新值。
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });
  const showOnlyFavoritesRef = useRef(showOnlyFavorites);
  useEffect(() => {
    showOnlyFavoritesRef.current = showOnlyFavorites;
  });

  // 這裡不直接呼叫 handleSearch(tribe)：因為 setFilterLetter('') 等 setState
  // 要到下次重新渲染才會生效，若在同一個事件處理常式裡緊接著呼叫 handleSearch，
  // fetchAllWords 讀到的仍是舊的篩選條件（stale closure）。改成把狀態重置好，
  // 交給下面「篩選條件變動」的 effect（已把 selectedTribe 也納入依賴）在重新
  // 渲染、狀態都確定生效之後再統一發出請求。
  const handleTribeChange = (tribe) => {
    setSelectedTribe(tribe);
    setQuery('');
    setFilterLetter('');
    setFrequencyFilter('');
    setSelectedSubCategory(null);
    setShowCategories(false);
    setDefinitions({ exact_match_results: {}, fuzzy_match_results: {} });
    setAllWords([]); setAllTotal(0); setAllOffset(0);
  };

  // 每次結果或篩選條件變動時，完全匹配／相關匹配的分頁顯示筆數重置回第一頁，
  // 避免舊頁碼對到新的（更短的）結果。這兩個區塊的篩選排序仍在前端做（見 filterAndSortWords）
  useEffect(() => {
    setVisibleExactCount(PAGE_SIZE);
    setVisibleFuzzyCount(PAGE_SIZE);
  }, [definitions, filterLetter, frequencyFilter, showOnlyFavorites, selectedSubCategory, sortOrder]);

  // 「全部詞條」瀏覽時，篩選／排序／族語條件改變要重新向後端要資料（不是本地重新篩選），
  // 這裡統一處理（也包含 handleTribeChange 重置篩選條件之後的重新查詢，見上方註解）。
  // 用 ref 跳過掛載時的第一次執行，避免跟下面掛載用的 handleSearch() 重複打一次 API；
  // 有輸入關鍵字時（query 非空）不做任何事，因為完全/相關匹配結果本來就是前端篩選，不需要重打 API。
  const didMountFilterEffect = useRef(false);
  useEffect(() => {
    if (!didMountFilterEffect.current) {
      didMountFilterEffect.current = true;
      return;
    }
    if (queryRef.current.trim() === '') {
      handleSearchRef.current();
    }
  }, [selectedTribe, filterLetter, frequencyFilter, showOnlyFavorites, selectedSubCategory, sortOrder]);

  // 收藏清單變動時，如果目前正用「只顯示收藏」瀏覽全部詞條，重新拉一次目前頁次，
  // 讓被取消收藏的詞條即時從畫面上消失（showOnlyFavorites 預設 false，掛載當下不會誤觸發）
  useEffect(() => {
    if (showOnlyFavoritesRef.current && queryRef.current.trim() === '') {
      handleSearchRef.current();
    }
  }, [favoriteWords]);

  useEffect(() => {
    handleSearchRef.current();
  }, []);

  const filterAndSortWords = (words) => sortWords(words, {
    filterLetter, frequencyFilter, showOnlyFavorites, favoriteWords, selectedSubCategory, sortOrder,
  });

  return (
    <div className="yy-page search-page">
    <Container className="p-4">
      <SearchHeader
        query={query} setQuery={setQuery} handleSearch={handleSearch}
        loading={loading}
        tribes={tribes} selectedTribe={selectedTribe} handleTribeChange={handleTribeChange}
        isMobile={isMobile}
        showFilterPanel={showFilterPanel} setShowFilterPanel={setShowFilterPanel}
        sortOrder={sortOrder} setSortOrder={setSortOrder}
        filterLetter={filterLetter} setFilterLetter={setFilterLetter}
        frequencyFilter={frequencyFilter} setFrequencyFilter={setFrequencyFilter}
        showOnlyFavorites={showOnlyFavorites} setShowOnlyFavorites={setShowOnlyFavorites}
        alphabet={ALPHABET}
        showCategories={showCategories} setShowCategories={setShowCategories}
        activeTab={activeTab} setActiveTab={setActiveTab}
        selectedSubCategory={selectedSubCategory} setSelectedSubCategory={setSelectedSubCategory}
      />

      <br />
      {loading && <Spinner animation="border" variant="primary" />}
      {error && (
        <Alert variant="danger" className="d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <Button type="button" variant="outline-danger" size="sm" onClick={() => handleSearch()} disabled={loading}>
            重試
          </Button>
        </Alert>
      )}
      {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}

      {!TRIBES_WITH_DATA.includes(selectedTribe) && !loading && (
        <div className="tribe-empty-state">
          <div
            className="tribe-empty-badge"
            data-tribe={selectedTribe}
          >
            {selectedTribe}
          </div>
          <h3 className="tribe-empty-title">{selectedTribe}族語詞典</h3>
          <p className="tribe-empty-desc">詞典資料建置中，敬請期待</p>
        </div>
      )}

      {TRIBES_WITH_DATA.includes(selectedTribe) && allWords.length > 0 && (
        <WordResultsSection
          title="全部詞條"
          titleColorClass="text-primary"
          buttonVariant="outline-danger"
          wordsFlat={allWords}
          serverPaginated
          totalCount={allTotal}
          loadingMore={loadingMoreAll}
          onLoadMore={handleLoadMoreAll}
          expandedWord={expandedWord}
          toggleExpand={toggleExpand}
          toggleFavorite={toggleFavorite}
          playAudio={playAudio}
          playSentence={playSentence}
          favoriteWords={favoriteWords}
          failedAudio={failedAudio}
          hasSentenceAudio={hasSentenceAudio}
        />
      )}

      {TRIBES_WITH_DATA.includes(selectedTribe) && Object.keys(definitions.exact_match_results).length > 0 && (
        <WordResultsSection
          title="完全匹配結果"
          titleColorClass="text-success"
          buttonVariant="outline-success"
          wordsFlat={Object.values(definitions.exact_match_results).flat()}
          visibleCount={visibleExactCount}
          onLoadMore={() => setVisibleExactCount(c => c + PAGE_SIZE)}
          filterAndSortWords={filterAndSortWords}
          expandedWord={expandedWord}
          toggleExpand={toggleExpand}
          toggleFavorite={toggleFavorite}
          playAudio={playAudio}
          playSentence={playSentence}
          favoriteWords={favoriteWords}
          failedAudio={failedAudio}
          hasSentenceAudio={hasSentenceAudio}
        />
      )}
      <br />
      {TRIBES_WITH_DATA.includes(selectedTribe) && Object.keys(definitions.fuzzy_match_results).length > 0 && (
        <WordResultsSection
          title="相關匹配結果"
          titleColorClass="text-warning"
          buttonVariant="outline-warning"
          wordsFlat={Object.values(definitions.fuzzy_match_results).flatMap(wordGroup => Object.values(wordGroup).flat())}
          visibleCount={visibleFuzzyCount}
          onLoadMore={() => setVisibleFuzzyCount(c => c + PAGE_SIZE)}
          filterAndSortWords={filterAndSortWords}
          expandedWord={expandedWord}
          toggleExpand={toggleExpand}
          toggleFavorite={toggleFavorite}
          playAudio={playAudio}
          playSentence={playSentence}
          favoriteWords={favoriteWords}
          failedAudio={failedAudio}
          hasSentenceAudio={hasSentenceAudio}
        />
      )}
    </Container>
    </div>
  );
};

export default SearchPage;
