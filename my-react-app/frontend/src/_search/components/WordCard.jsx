import { memo, useCallback, useId } from 'react';
import { ListGroup } from 'react-bootstrap';
import StarRating from '../../../components/ui/StarRating';
import AudioPlayButton from '../../../components/ui/AudioPlayButton';
import FavoriteButton from '../../../components/ui/FavoriteButton';
import { isAuthFailedAudio } from '../../../hooks/useAuthorizedAudioPlayback';
import WordDetailBody from './WordDetailBody';
import { pickFirstSentence } from './wordDetailSummary';
import '../../../static/css/_search/wordCard.css';

// 字卡的展開／收合用 disclosure 模式（審查項 P2-40）：標題（h3）裡放一顆真正的按鈕，帶 aria-expanded 與
// aria-controls；播放、收藏是標題旁邊獨立的按鈕，不再巢狀放在另一個 role=button 的 div 裡。
// 展開內容裡原本拿 h5／h6 當樣式用，會讓標題層級亂跳（頁面 h1 → h2 區塊標題 → h3 詞條 → 其餘都是純文字），改用段落。
const WordCard = memo(({ word, result, keyName, isExpanded, toggleExpand, toggleFavorite, wordName, playAudio, playSentence, hasSentenceAudio, isFavorited, failedAudio, onOpenDetail, stopAudio, retryAudio, isPlayingWord = false, playingDuration = 0 }) => {
  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(wordName);
  }, [toggleFavorite, wordName]);
  const panelId = useId();

  // 單詞查詢頁傳 onOpenDetail：點標題開詳情 sheet，字卡本身不展開（兩層卡片：上層詞與詞義，下層詞性與詞頻）
  const firstDef = result.explanationItems?.[0];
  const metaTags = [firstDef?.partOfSpeech, firstDef?.category].filter((t) => typeof t === 'string' && t.trim());

  const wordFileId = result.audioItems?.[0]?.fileId;
  const wordAudioFailed = Boolean(wordFileId && failedAudio?.has(wordFileId));
  const hasWordAudio = Boolean(wordFileId);
  // 一行例句預覽：只在查詢頁（有詳情面板）顯示，原文加華語一起排在一行，太長就截斷
  const sentence = onOpenDetail ? pickFirstSentence(result) : null;
  const preview = sentence ? [sentence.originalSentence?.trim(), sentence.chineseSentence?.trim()].filter(Boolean).join('　') : '';

  return (
  <ListGroup.Item className="d-flex flex-column" data-letter={(result.name || '').slice(0, 1).toLowerCase()}>
    <div className="d-flex justify-content-between align-items-center word-card-head">
      <h3 className="fw-bolder word-card-heading">
        <button
          type="button"
          className="word-card-toggle"
          {...(onOpenDetail
            // data-word-key：詳情面板換詞後關閉，用它找回「最後看的那個詞」的字卡（稽核 FE3-15）
            ? { 'aria-haspopup': 'dialog', 'data-word-key': keyName }
            : { 'aria-expanded': isExpanded, 'aria-controls': panelId })}
          onClick={(e) => (onOpenDetail ? onOpenDetail({ keyName, word, result }, e) : toggleExpand(keyName))}
        >
          <span className="word-card-name">{result.name || '無資料'}</span>
          <span className="word-card-gloss">{word}</span>
        </button>
      </h3>
      <div className="d-flex align-items-center word-card-actions">
        {hasWordAudio && (
          <AudioPlayButton
            name={result.name}
            playing={isPlayingWord}
            duration={playingDuration}
            failed={wordAudioFailed}
            authRequired={isAuthFailedAudio(failedAudio, wordFileId)}
            onPlay={() => playAudio(wordFileId)}
            onStop={stopAudio}
            onRetry={() => retryAudio?.(wordFileId)}
          />
        )}
        <FavoriteButton name={result.name} isFavorited={isFavorited} onToggle={handleToggleFavorite} size={20} />
      </div>
    </div>
    {onOpenDetail && (metaTags.length > 0 || Number(result.frequency) > 0) && (
      <div className="word-card-meta">
        {metaTags.map((tag) => <span key={tag} className="word-card-tag">{tag}</span>)}
        {Number(result.frequency) > 0 && <StarRating frequency={result.frequency} />}
      </div>
    )}
    {preview && <p className="word-card-example">{preview}</p>}
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
