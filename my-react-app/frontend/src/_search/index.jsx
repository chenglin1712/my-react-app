import { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { Container, Alert, Spinner, Button } from 'react-bootstrap';
import { useFavorites } from "../../src/userServives/useFavorites";
import { TRIBE_NAMES } from "../constants/tribes";
import { auth } from "../../../firebase";
import "../../static/css/_search/index.css";

import SearchHeader from './components/SearchHeader';
import WordResultsSection from './components/WordResultsSection';
import useAudioPlayback from './hooks/useAudioPlayback';

const PAGE_SIZE = 50;

const App = () => {
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
    () => new Set(favorites.find(fav => fav.id === 1)?.content || []),
    [favorites]
  );
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [frequencyFilter, setFrequencyFilter] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [visibleExactCount, setVisibleExactCount] = useState(PAGE_SIZE);
  const [visibleFuzzyCount, setVisibleFuzzyCount] = useState(PAGE_SIZE);
  const [showCategories, setShowCategories] = useState(false);
  const [activeTab, setActiveTab] = useState('語法與功能');
  const [selectedSubCategory, setSelectedSubCategory] = useState(null);
  const [selectedTribe, setSelectedTribe] = useState('泰雅');
  const [audioAvailable] = useState(true);

  const { playAudio, playSentence, failedAudio } = useAudioPlayback(selectedTribe, setError);

  const tribes = TRIBE_NAMES;

  const toggleExpand = (key) => setExpandedWord(prev => (prev === key ? null : key));

  // 目前資料庫已有資料的族語跟支援的族語清單相同，用同一份共用清單；未來若新增
  // 族語但辭典資料還沒建好，這裡可以改成 TRIBE_NAMES 的子集合。
  const TRIBES_WITH_DATA = TRIBE_NAMES;

  // 「全部詞條」瀏覽（沒有輸入關鍵字）：字母／詞頻／分類／收藏篩選與排序都交給後端做，
  // 這裡只帶目前的篩選條件 + limit/offset 向 /dictionary/all/ 要一頁資料。
  // append=true 時是「載入更多」，接在目前已載入的 allWords 後面；append=false 是重新查詢，取代整份清單。
  const fetchAllWords = async (tribe, { append = false } = {}) => {
    const token = await auth.currentUser?.getIdToken();
    const authHeaders = token ? { "Authorization": `Bearer ${token}` } : {};
    const offset = append ? allOffset : 0;
    const body = { tribe, limit: PAGE_SIZE, offset, sort_order: sortOrder };
    if (filterLetter) body.letter = filterLetter;
    if (frequencyFilter) body.frequency = parseInt(frequencyFilter, 10);
    if (selectedSubCategory) body.category = selectedSubCategory;
    if (showOnlyFavorites) {
      body.favorites_only = true;
      body.favorite_names = Array.from(favoriteWords);
    }
    const res = await axios.post(import.meta.env.VITE_API_SEARCH_ALL_URL, body, { headers: authHeaders });
    const pageWords = Object.values(res.data.all_results || {}).flat();
    setAllWords(prev => (append ? [...prev, ...pageWords] : pageWords));
    setAllTotal(res.data.total ?? pageWords.length);
    setAllOffset(offset + pageWords.length);
  };

  const handleLoadMoreAll = async () => {
    if (loadingMoreAll) return;
    setLoadingMoreAll(true);
    try {
      await fetchAllWords(selectedTribe, { append: true });
    } catch (e) {
      setError('載入更多失敗: ' + (e.response?.data?.detail || e.message));
    } finally {
      setLoadingMoreAll(false);
    }
  };

  const handleSearch = async (tribeOverride = null) => {
    if (loading) return;
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
        await fetchAllWords(tribe, { append: false });
        setDefinitions({ exact_match_results: {}, fuzzy_match_results: {} });
      } else {
        const token = await auth.currentUser?.getIdToken();
        const authHeaders = token ? { "Authorization": `Bearer ${token}` } : {};
        const res = await axios.post(import.meta.env.VITE_API_SEARCH_KEY_URL, { keyword: query.trim(), tribe }, { headers: authHeaders });
        setDefinitions({
          exact_match_results: Array.isArray(res.data.exact_match_results) ? { [query.trim()]: res.data.exact_match_results } : res.data.exact_match_results,
          fuzzy_match_results: res.data.fuzzy_match_results || {},
        });
        setAllWords([]); setAllTotal(0); setAllOffset(0);
      }
    } catch (e) {
      setError('查詢失敗: ' + (e.response?.data?.detail || e.message));
    } finally {
      setLoading(false);
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
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  useEffect(() => {
    handleSearchRef.current();
  }, []);

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

        // 跳過非字母前綴（-、ʼ、' 等），取第一個字母作為排序依據
        const getKey = (s) => s.replace(/^[^a-z]+/, '') || s;
        const aKey = getKey(aFirst);
        const bKey = getKey(bFirst);

        // 純非字母開頭的詞條（如 -a、-an）排在最後
        const aIsPrefix = /^[^a-z]/.test(aFirst);
        const bIsPrefix = /^[^a-z]/.test(bFirst);

        if (sortOrder === 'asc') {
          if (aIsPrefix && !bIsPrefix) return 1;
          if (!aIsPrefix && bIsPrefix) return -1;
          return aKey.localeCompare(bKey, undefined, { sensitivity: 'base' }) || aFirst.localeCompare(bFirst, undefined, { sensitivity: 'base' });
        } else {
          if (aIsPrefix && !bIsPrefix) return -1;
          if (!aIsPrefix && bIsPrefix) return 1;
          return bKey.localeCompare(aKey, undefined, { sensitivity: 'base' }) || bFirst.localeCompare(aFirst, undefined, { sensitivity: 'base' });
        }
      });
  };
  const excludedLetters = ['d', 'f', 'j', 'v'];
  const alphabet = Array.from({ length: 26 }, (_, i) => String.fromCharCode(97 + i)).concat("'").filter(l => !excludedLetters.includes(l));


  return (
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
        alphabet={alphabet}
        showCategories={showCategories} setShowCategories={setShowCategories}
        activeTab={activeTab} setActiveTab={setActiveTab}
        selectedSubCategory={selectedSubCategory} setSelectedSubCategory={setSelectedSubCategory}
      />

      <br />
      {loading && <Spinner animation="border" variant="primary" />}
      {error && (
        <Alert variant="danger" className="d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <Button variant="outline-danger" size="sm" onClick={() => handleSearch()} disabled={loading}>
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
          audioAvailable={audioAvailable}
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
          audioAvailable={audioAvailable}
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
          audioAvailable={audioAvailable}
        />
      )}
    </Container>
  );
};

export default App;
