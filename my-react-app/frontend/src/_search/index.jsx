import { useState, useEffect } from 'react';
import axios from 'axios';
import { Container, Alert, Spinner, Button } from 'react-bootstrap';
import { authChanges } from "../../src/userServives/userServive";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db, auth } from "../../../firebase";
import "../../static/css/_search/index.css";

import SearchHeader from './components/SearchHeader';
import WordResultsSection from './components/WordResultsSection';
import useAudioPlayback from './hooks/useAudioPlayback';

const PAGE_SIZE = 50;

const App = () => {
  const [query, setQuery] = useState('');
  const [definitions, setDefinitions] = useState({ exact_match_results: {}, fuzzy_match_results: {}, all_results: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedWord, setExpandedWord] = useState(null);
  const [favoriteWords, setFavoriteWords] = useState(new Set());
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterLetter, setFilterLetter] = useState('');
  const [user, setUser] = useState(null);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [frequencyFilter, setFrequencyFilter] = useState('');
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [visibleAllCount, setVisibleAllCount] = useState(PAGE_SIZE);
  const [visibleExactCount, setVisibleExactCount] = useState(PAGE_SIZE);
  const [visibleFuzzyCount, setVisibleFuzzyCount] = useState(PAGE_SIZE);
  const [showCategories, setShowCategories] = useState(false);
  const [activeTab, setActiveTab] = useState('語法與功能');
  const [selectedSubCategory, setSelectedSubCategory] = useState(null);
  const [selectedTribe, setSelectedTribe] = useState('泰雅');
  const [audioAvailable] = useState(true);

  const { playAudio, playSentence, failedAudio } = useAudioPlayback(selectedTribe, setError);

  const tribes = ['泰雅', '阿美', '布農', '葛瑪蘭', '排灣'];



  const toggleExpand = (key) => setExpandedWord(prev => (prev === key ? null : key));

  const toggleFavorite = async (wordTayal) => {
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
        return {
          ...prevUser,
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

  const TRIBES_WITH_DATA = ['泰雅', '阿美', '布農', '葛瑪蘭', '排灣'];

  const handleSearch = async (tribeOverride = null) => {
    if (loading) return;
    const tribe = tribeOverride ?? selectedTribe;
    if (!TRIBES_WITH_DATA.includes(tribe)) {
      setDefinitions({ exact_match_results: {}, fuzzy_match_results: {}, all_results: {} });
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = await auth.currentUser?.getIdToken();
      const authHeaders = token ? { "Authorization": `Bearer ${token}` } : {};
      let res;
      if (query.trim() === '') {
        res = await axios.post(import.meta.env.VITE_API_SEARCH_ALL_URL, { keyword: '', tribe }, { headers: authHeaders });
        setDefinitions({ exact_match_results: {}, fuzzy_match_results: {}, all_results: res.data.all_results || {} });
      } else {
        res = await axios.post(import.meta.env.VITE_API_SEARCH_KEY_URL, { keyword: query.trim(), tribe }, { headers: authHeaders });
        setDefinitions({
          exact_match_results: Array.isArray(res.data.exact_match_results) ? { [query.trim()]: res.data.exact_match_results } : res.data.exact_match_results,
          fuzzy_match_results: res.data.fuzzy_match_results || {},
          all_results: {}
        });
      }
    } catch (e) {
      setError('查詢失敗: ' + (e.response?.data?.detail || e.message));
    } finally {
      setLoading(false);
    }
  };

  const handleTribeChange = (tribe) => {
    setSelectedTribe(tribe);
    setQuery('');
    setFilterLetter('');
    setFrequencyFilter('');
    setSelectedSubCategory(null);
    setShowCategories(false);
    setDefinitions({ exact_match_results: {}, fuzzy_match_results: {}, all_results: {} });
    handleSearch(tribe);
  };

  // 每次結果或篩選條件變動時，分頁顯示筆數重置回第一頁，避免舊頁碼對到新的（更短的）結果
  useEffect(() => {
    setVisibleAllCount(PAGE_SIZE);
    setVisibleExactCount(PAGE_SIZE);
    setVisibleFuzzyCount(PAGE_SIZE);
  }, [definitions, filterLetter, frequencyFilter, showOnlyFavorites, selectedSubCategory, sortOrder]);

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
    handleSearch();
    const unsubscribe = authChanges(async (userData) => {
      //console.log("authChanges 回傳:", userData);
      if (userData) {
        setUser(userData);
        const baseCategory = userData.firestoreData?.favorites?.find(fav => fav.id === 1);
        const favoriteSet = new Set(baseCategory?.content || []);
        setFavoriteWords(favoriteSet);
      } else {
        setUser(null);
        setFavoriteWords(new Set());
      }
    });
    return () => unsubscribe();
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

      {TRIBES_WITH_DATA.includes(selectedTribe) && Object.keys(definitions.all_results).length > 0 && (
        <WordResultsSection
          title="全部詞條"
          titleColorClass="text-primary"
          buttonVariant="outline-danger"
          wordsFlat={Object.values(definitions.all_results).flat()}
          visibleCount={visibleAllCount}
          onLoadMore={() => setVisibleAllCount(c => c + PAGE_SIZE)}
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
