import { ListGroup, Button } from 'react-bootstrap';
import WordCard from './WordCard';
import ErrorBoundary from '../../errorBoundary';

// 全部詞條／完全匹配／相關匹配三個結果區塊原本各自複製一份幾乎一樣的
// 「篩選排序 -> 分頁顯示 -> 載入更多」邏輯，這裡抽成共用元件。
//
// serverPaginated=true 時（目前用於「全部詞條」區塊）：篩選／排序／分頁都已經在
// 後端做完，wordsFlat 就是目前已載入的頁面資料（累積），totalCount 是後端算出的
// 篩選後總筆數，不再套用 filterAndSortWords 或本地 slice；onLoadMore 改成向後端
// 要下一頁，而不是單純顯示更多已載入的資料。
const WordResultsSection = ({
  title,
  titleColorClass,
  buttonVariant,
  wordsFlat,
  visibleCount,
  onLoadMore,
  filterAndSortWords,
  expandedWord,
  toggleExpand,
  toggleFavorite,
  playAudio,
  playSentence,
  favoriteWords,
  failedAudio,
  audioAvailable,
  serverPaginated = false,
  totalCount,
  loadingMore = false,
}) => {
  const filteredSorted = serverPaginated ? wordsFlat : filterAndSortWords(wordsFlat);
  const visibleWords = serverPaginated ? wordsFlat : filteredSorted.slice(0, visibleCount);
  const total = serverPaginated ? (totalCount ?? wordsFlat.length) : filteredSorted.length;
  const remaining = Math.max(0, total - visibleWords.length);

  return (
    <>
      <h4 className={`fw-bold ${titleColorClass}`}>{title} ({total})</h4>
      <ListGroup>
        {visibleWords.map((wordData, idx) => {
          const word = wordData.explanationItems?.[0]?.chineseExplanation || wordData.chineseExplanation || '';
          const key = `${word}-${idx}-${wordData.name || ''}`;
          return (
            // 單張字卡的資料若有缺陷導致渲染出錯，只讓這一張卡片顯示錯誤提示，
            // 不要讓整個搜尋結果列表跟著消失。
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
                toggleFavorite={() => toggleFavorite(wordData.name)}
                playAudio={playAudio}
                playSentence={playSentence}
                isFavorited={favoriteWords.has(wordData.name)}
                failedAudio={failedAudio}
                audioAvailable={audioAvailable}
              />
            </ErrorBoundary>
          );
        })}
      </ListGroup>
      {remaining > 0 && (
        <div className="text-center my-3">
          <Button variant={buttonVariant} onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? '載入中...' : `載入更多（剩 ${remaining} 筆）`}
          </Button>
        </div>
      )}
    </>
  );
};

export default WordResultsSection;
