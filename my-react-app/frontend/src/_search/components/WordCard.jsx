import { memo, useCallback, useId } from 'react';
import { ListGroup, Button } from 'react-bootstrap';
import { Heart, CirclePlay } from 'lucide-react';
import StarRating from '../../../components/ui/StarRating';
import WordDetailBody from './WordDetailBody';
import '../../../static/css/_search/wordCard.css';

// 字卡的展開／收合用 disclosure 模式（審查項 P2-40）：標題（h3）裡放一顆真正的按鈕，帶 aria-expanded 與
// aria-controls；播放、收藏是標題旁邊獨立的按鈕，不再巢狀放在另一個 role=button 的 div 裡。
// 展開內容裡原本拿 h5／h6 當樣式用，會讓標題層級亂跳（頁面 h1 → h2 區塊標題 → h3 詞條 → 其餘都是純文字），改用段落。
const WordCard = memo(({ word, result, keyName, isExpanded, toggleExpand, toggleFavorite, wordName, playAudio, playSentence, hasSentenceAudio, isFavorited, failedAudio, onOpenDetail }) => {
  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(wordName);
  }, [toggleFavorite, wordName]);
  const panelId = useId();

  // 單詞查詢頁傳 onOpenDetail：點標題開詳情 sheet，字卡本身不展開（兩層卡片：上層詞與詞義，下層詞性與詞頻）
  const firstDef = result.explanationItems?.[0];
  const metaTags = [firstDef?.partOfSpeech, firstDef?.category].filter((t) => typeof t === 'string' && t.trim());

  const hasWordAudio = result.audioItems?.length > 0 && !failedAudio?.has(result.audioItems[0].fileId);

  return (
  <ListGroup.Item className="d-flex flex-column">
    <div className="d-flex justify-content-between align-items-center word-card-head">
      <h3 className="fw-bolder word-card-heading">
        <button
          type="button"
          className="word-card-toggle"
          {...(onOpenDetail
            ? { 'aria-haspopup': 'dialog' }
            : { 'aria-expanded': isExpanded, 'aria-controls': panelId })}
          onClick={() => (onOpenDetail ? onOpenDetail({ keyName, word, result }) : toggleExpand(keyName))}
        >
          <span className="word-card-name">{result.name || '無資料'}</span>
          <span className="word-card-gloss">{word}</span>
        </button>
      </h3>
      <div className="d-flex align-items-center word-card-actions">
        {hasWordAudio && (
          <Button type="button" variant="link" aria-label={`播放「${result.name}」的發音`} onClick={() => playAudio(result.audioItems[0].fileId)}>
            <CirclePlay size={20} className="yy-icon word-card-icon" aria-hidden="true" />
          </Button>
        )}
        <Button type="button" variant="link" aria-label={isFavorited ? "取消收藏" : "加入收藏"} aria-pressed={isFavorited} onClick={handleToggleFavorite}>
          {isFavorited ? <Heart size="1em" className="yy-icon" color="var(--yy-calm-danger)" fill="var(--yy-calm-danger)" aria-hidden="true" /> : <Heart size="1em" className="yy-icon" color="var(--yy-calm-text)" aria-hidden="true" />}
        </Button>
      </div>
    </div>
    {onOpenDetail && (metaTags.length > 0 || Number(result.frequency) > 0) && (
      <div className="word-card-meta">
        {metaTags.map((tag) => <span key={tag} className="word-card-tag">{tag}</span>)}
        {Number(result.frequency) > 0 && <StarRating frequency={result.frequency} />}
      </div>
    )}
    {!onOpenDetail && isExpanded && (
      <div className="mt-2 pt-2 border-top" id={panelId}>
        <WordDetailBody
          result={result}
          playAudio={playAudio}
          playSentence={playSentence}
          hasSentenceAudio={hasSentenceAudio}
          failedAudio={failedAudio}
        />
      </div>
    )}
  </ListGroup.Item>
  );
});
WordCard.displayName = "WordCard";

export default WordCard;
