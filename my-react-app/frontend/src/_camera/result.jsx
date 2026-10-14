import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from 'react-bootstrap';
import LoadingSpinner from '@components/ui/LoadingSpinner';
import { apiPost } from "../../utils/apiClient";
import { announce } from "@utils/announce";
import { countMatchedWords } from "../../utils/wordFilterSort";
import { useFavorites } from "../../src/userServives/useFavorites";
import "../../static/css/_camera/result.css";
import { filterAndSortWords as sortWords } from "../../utils/wordFilterSort";
import useAudioPlayback from "../../hooks/useAudioPlayback";
import { useIsMobile } from "../../hooks/useIsMobile";
import CameraFilterControls from "./components/CameraFilterControls";
import WordResultsSection from "../_search/components/WordResultsSection";
import EmptyState from "@components/ui/EmptyState";
import { describeActiveFilters } from "@utils/wordFilterState";
import { deriveInitialLetters } from "@utils/wordLetters";
import { Button } from "react-bootstrap";
import TribePill from "../../components/ui/TribePill";
import { TRIBES } from "../constants/tribes";

const WORD_FAVORITES_CATEGORY_ID = 1;

// 影像辨識精靈第 3 步：查詢辨識出的單詞並顯示完整詞典結果。
// selectedWords/tribe 由 index.jsx（精靈容器）傳入，取代原本從路由 state 讀取；
// onRestart 取代原本「返回 /camera」的導頁，改成重置精靈狀態回到第 1 步。
const CameraResultStep = ({ selectedWords, tribe, onTribeChange, onBack, onRestart }) => {
  const [definitions, setDefinitions] = useState({ exact_match_results: {}, fuzzy_match_results: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedWord, setExpandedWord] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterLetter, setFilterLetter] = useState('');
  const { favorites, toggleFavorite, error: favoritesError } = useFavorites();
  const favoriteWords = useMemo(
    () => new Set(favorites.find(fav => fav.id === WORD_FAVORITES_CATEGORY_ID)?.content || []),
    [favorites]
  );
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [frequencyFilter, setFrequencyFilter] = useState('');
  const isMobile = useIsMobile();
  const [showCategories, setShowCategories] = useState(false);
  const [activeTab, setActiveTab] = useState('語法與功能');
  const [selectedSubCategory, setSelectedSubCategory] = useState(null)
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // 快速切換族語（回上一步重選）可能讓舊族語的查詢晚一步回來，蓋掉新族語已經
  // 顯示的結果；用 generation 讓過期的回應不再更新畫面。
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    const myGeneration = ++requestGenerationRef.current;

    if (selectedWords.length === 0) {
      setError("請選擇至少一個單詞！");
      setDefinitions({ exact_match_results: {}, fuzzy_match_results: {} });
      return undefined;
    }

    setLoading(true);
    setError("");
    announce("查詢中，請稍候");
    // apiPost 內部一定會回傳 Promise（即使 auth.currentUser 是 null，token 只影響
    // 要不要帶 Authorization header），不會有「未登入時整條 .then/.catch/.finally
    // 都不執行、loading 卡住」的問題。
    apiPost(import.meta.env.VITE_API_SEARCH_KEYS_URL, { words: selectedWords, tribe })
      .then(data => {
        if (myGeneration !== requestGenerationRef.current) return;
        setDefinitions({
          exact_match_results: data.exact_match_results || {},
          fuzzy_match_results: data.fuzzy_match_results || {},
        });
        const count = countMatchedWords(data.exact_match_results, data.fuzzy_match_results);
        announce(count > 0 ? `找到 ${count} 筆結果` : "沒有找到符合的詞");
      })
      .catch(err => {
        if (myGeneration !== requestGenerationRef.current) return;
        setError("查詢失敗: " + err.message);
        announce("查詢失敗", { assertive: true });
      })
      .finally(() => {
        if (myGeneration === requestGenerationRef.current) setLoading(false);
      });
    // 步驟卸載（例如按「重新辨識」）時讓還在跑的查詢作廢，不再更新畫面或公告
    return () => { requestGenerationRef.current += 1; };
  }, [selectedWords, tribe, retryCount]);

  const toggleExpand = (key) => setExpandedWord(prev => (prev === key ? null : key));

  // playAudio 改用 _search 頁面共用的 hook：原本這裡自己維護一份 playAudio，
  // 缺少 hook 版本後來補上的「取消上一次播放的請求」（避免快速連續點擊時舊音檔
  // 蓋掉新音檔）與「失敗音檔追蹤」（播放失敗過的 fileId 不再顯示播放鈕）。
  const { playAudio, failedAudio } = useAudioPlayback(tribe, setError);

  const filterAndSortWords = (words) => sortWords(words, {
    filterLetter, frequencyFilter, showOnlyFavorites, favoriteWords, selectedSubCategory, sortOrder,
  });

  const exactMatchWords = filterAndSortWords(Object.values(definitions.exact_match_results).flat());
  const fuzzyMatchWords = filterAndSortWords(
    Object.values(definitions.fuzzy_match_results).flatMap(wordGroup => Object.values(wordGroup).flat())
  );

  // 開頭字母只列出這批辨識結果裡真的出現過的字母（見 utils/wordLetters.js）
  const alphabet = useMemo(() => deriveInitialLetters([
    ...Object.values(definitions.exact_match_results).flat(),
    ...Object.values(definitions.fuzzy_match_results).flatMap(wordGroup => Object.values(wordGroup).flat()),
  ]), [definitions]);

  const activeFilterParts = describeActiveFilters({ filterLetter, frequencyFilter, showOnlyFavorites, selectedSubCategory });
  const hasRawResults = Object.keys(definitions.exact_match_results).length > 0 || Object.keys(definitions.fuzzy_match_results).length > 0;
  const noVisibleResults = exactMatchWords.length === 0 && fuzzyMatchWords.length === 0;
  const clearFilters = () => {
    setFilterLetter('');
    setFrequencyFilter('');
    setShowOnlyFavorites(false);
    setSelectedSubCategory(null);
  };

  return (
    <div className="yy-fade-up camera-step3">
      <div className="camera-step3-header">
        <h2 className="camera-step3-title">查詢結果</h2>
        <div className="camera-step3-nav">
          <button type="button" className="yy-btn-outline" onClick={onBack}>◂ 回到選詞</button>
          <button type="button" className="yy-btn-outline" onClick={onRestart}>重新上傳圖片</button>
        </div>
      </div>

      {/* 族語在這一步才有作用（查詢結果用哪個族語），所以放在這裡，切換會立刻重新查詢 */}
      <div className="camera-tribe-row" role="group" aria-label="查詢的族語">
        {TRIBES.map((t) => (
          <TribePill key={t.slug} tribe={t} active={tribe === t.slug} onClick={() => onTribeChange(t.slug)} />
        ))}
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
        onBack={onBack}
      />

      {loading && <LoadingSpinner label="查詢中…" />}
      {error && (
        <Alert variant="danger" role="alert">
          <p className="mb-2">{error}</p>
          {selectedWords.length > 0 && (
            <Button type="button" variant="danger" size="sm" onClick={() => setRetryCount((n) => n + 1)}>重試</Button>
          )}
        </Alert>
      )}
      {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}

      {!loading && !error && noVisibleResults && (
        <EmptyState
          title={activeFilterParts.length > 0 && hasRawResults ? '目前的條件下沒有符合的詞' : '辭典裡找不到這些字詞'}
          actions={(
            <>
              {activeFilterParts.length > 0 && <Button type="button" variant="danger" onClick={clearFilters}>清除篩選</Button>}
              <Button type="button" variant="outline-dark" onClick={onBack}>回到選詞</Button>
              <Button type="button" variant="outline-dark" onClick={onRestart}>重新上傳圖片</Button>
            </>
          )}
        >
          {activeFilterParts.length > 0 && hasRawResults
            ? <p>目前的篩選條件：{activeFilterParts.join('、')}。</p>
            : <p>可以回到選詞多選幾個詞，或換一張圖片再試；也可以切換上方的族語看看。</p>}
        </EmptyState>
      )}

      <br />
      {exactMatchWords.length > 0 && (
        <WordResultsSection
          title="完全符合結果"
          titleColorClass="text-success"
          wordsFlat={exactMatchWords}
          expandedWord={expandedWord}
          toggleExpand={toggleExpand}
          toggleFavorite={toggleFavorite}
          playAudio={playAudio}
          favoriteWords={favoriteWords}
          failedAudio={failedAudio}
        />
      )}
      <br />
      {fuzzyMatchWords.length > 0 && (
        <WordResultsSection
          title="相關結果"
          titleColorClass="text-warning"
          wordsFlat={fuzzyMatchWords}
          expandedWord={expandedWord}
          toggleExpand={toggleExpand}
          toggleFavorite={toggleFavorite}
          playAudio={playAudio}
          favoriteWords={favoriteWords}
          failedAudio={failedAudio}
        />
      )}
    </div>
  );
};

export default CameraResultStep;
