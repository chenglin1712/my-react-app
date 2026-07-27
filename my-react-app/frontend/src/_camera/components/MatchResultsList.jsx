import { ListGroup } from 'react-bootstrap';
import ErrorBoundary from "../../errorBoundary";
import WordCard from "../../_search/components/WordCard";

/**
 * 完全匹配／相關匹配結果各自的清單渲染，原本 result.jsx 裡兩段幾乎逐行相同
 * （只差標題文字/顏色跟資料來源），這裡合併成一份共用元件。
 */
export default function MatchResultsList({
  title, titleColorClass, words,
  expandedWord, toggleExpand, toggleFavorite, playAudio, favoriteWords, failedAudio,
}) {
  if (words.length === 0) return null;

  return (
    <>
      <h4 className={`fw-bold ${titleColorClass}`}>{title} ({words.length})</h4>
      <ListGroup>
        {words.map((wordData, idx) => {
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
                isExpanded={expandedWord === key}
                toggleExpand={toggleExpand}
                toggleFavorite={toggleFavorite}
                wordName={wordData.name}
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
}
