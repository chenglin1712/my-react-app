import { ListGroup, Button } from 'react-bootstrap';
import WordCard from './WordCard';

// 全部詞條／完全匹配／相關匹配三個結果區塊原本各自複製一份幾乎一樣的
// 「篩選排序 -> 分頁顯示 -> 載入更多」邏輯，這裡抽成共用元件。
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
}) => {
  const filteredSorted = filterAndSortWords(wordsFlat);
  const visibleWords = filteredSorted.slice(0, visibleCount);

  return (
    <>
      <h4 className={`fw-bold ${titleColorClass}`}>{title} ({filteredSorted.length})</h4>
      <ListGroup>
        {visibleWords.map((wordData, idx) => {
          const word = wordData.explanationItems?.[0]?.chineseExplanation || wordData.chineseExplanation || '';
          const key = `${word}-${idx}-${wordData.name || ''}`;
          return (
            <WordCard
              key={key}
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
          );
        })}
      </ListGroup>
      {visibleCount < filteredSorted.length && (
        <div className="text-center my-3">
          <Button variant={buttonVariant} onClick={onLoadMore}>
            載入更多（剩 {Math.max(0, filteredSorted.length - visibleCount)} 筆）
          </Button>
        </div>
      )}
    </>
  );
};

export default WordResultsSection;
