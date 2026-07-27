import { useEffect, useMemo, useState } from "react";
import { Alert, Spinner } from 'react-bootstrap';
import { apiPost } from "../../utils/apiClient";
import { useFavorites } from "../../src/userServives/useFavorites";
import "../../static/css/_camera/result.css";
import { filterAndSortWords as sortWords } from "../../utils/wordFilterSort";
import useAudioPlayback from "../../hooks/useAudioPlayback";
import CameraFilterControls from "./components/CameraFilterControls";
import MatchResultsList from "./components/MatchResultsList";

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
    // apiPost 內部一定會回傳 Promise（即使 auth.currentUser 是 null，token 只影響
    // 要不要帶 Authorization header），不會有「未登入時整條 .then/.catch/.finally
    // 都不執行、loading 卡住」的問題。
    apiPost(import.meta.env.VITE_API_SEARCH_KEYS_URL, { words: selectedWords, tribe })
      .then(data => {
        setDefinitions({
          exact_match_results: data.exact_match_results || {},
          fuzzy_match_results: data.fuzzy_match_results || {},
        });
      })
      .catch(err => {
        setError("查詢失敗: " + err.message);
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

  const exactMatchWords = filterAndSortWords(Object.values(definitions.exact_match_results).flat());
  const fuzzyMatchWords = filterAndSortWords(
    Object.values(definitions.fuzzy_match_results).flatMap(wordGroup => Object.values(wordGroup).flat())
  );

  return (
    <div className="yy-fade-up camera-step3">
      <div className="camera-step3-header">
        <h2 className="camera-step3-title">查詢結果</h2>
        <button type="button" className="yy-btn-outline" onClick={onRestart}>↺ 重新辨識</button>
      </div>

      <CameraFilterControls
        isMobile={isMobile}
        showFilterPanel={showFilterPanel}
        setShowFilterPanel={setShowFilterPanel}
        sortOrder={sortOrder}
        setSortOrder={setSortOrder}
        filterLetter={filterLetter}
        setFilterLetter={setFilterLetter}
        alphabet={alphabet}
        frequencyFilter={frequencyFilter}
        setFrequencyFilter={setFrequencyFilter}
        showOnlyFavorites={showOnlyFavorites}
        setShowOnlyFavorites={setShowOnlyFavorites}
        showCategories={showCategories}
        setShowCategories={setShowCategories}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedSubCategory={selectedSubCategory}
        setSelectedSubCategory={setSelectedSubCategory}
        onRestart={onRestart}
      />

      {loading && <Spinner animation="border" variant="primary" />}
      {error && <Alert variant="danger">{error}</Alert>}
      {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}

      <br />
      <MatchResultsList
        title="完全匹配結果"
        titleColorClass="text-success"
        words={exactMatchWords}
        expandedWord={expandedWord}
        toggleExpand={toggleExpand}
        toggleFavorite={toggleFavorite}
        playAudio={playAudio}
        favoriteWords={favoriteWords}
        failedAudio={failedAudio}
      />
      <br />
      <MatchResultsList
        title="相關匹配結果"
        titleColorClass="text-warning"
        words={fuzzyMatchWords}
        expandedWord={expandedWord}
        toggleExpand={toggleExpand}
        toggleFavorite={toggleFavorite}
        playAudio={playAudio}
        favoriteWords={favoriteWords}
        failedAudio={failedAudio}
      />
    </div>
  );
};

export default CameraResultStep;
