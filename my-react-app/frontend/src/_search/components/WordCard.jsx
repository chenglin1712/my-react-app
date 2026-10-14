import { memo, useCallback, useId } from 'react';
import { ListGroup, Button } from 'react-bootstrap';
import { FaHeart, FaRegHeart, FaPlayCircle } from 'react-icons/fa';
import StarRating from '../../../components/ui/StarRating';
import '../../../static/css/_search/wordCard.css';

// 字卡的展開／收合用 disclosure 模式（審查項 P2-40）：標題（h3）裡放一顆真正的按鈕，帶 aria-expanded 與
// aria-controls；播放、收藏是標題旁邊獨立的按鈕，不再巢狀放在另一個 role=button 的 div 裡。
// 展開內容裡原本拿 h5／h6 當樣式用，會讓標題層級亂跳（頁面 h1 → h2 區塊標題 → h3 詞條 → 其餘都是純文字），改用段落。
const WordCard = memo(({ word, result, keyName, isExpanded, toggleExpand, toggleFavorite, wordName, playAudio, playSentence, hasSentenceAudio, isFavorited, failedAudio }) => {
  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(wordName);
  }, [toggleFavorite, wordName]);
  const panelId = useId();

  const hasWordAudio = result.audioItems?.length > 0 && !failedAudio?.has(result.audioItems[0].fileId);

  return (
  <ListGroup.Item className="d-flex flex-column">
    <div className="d-flex justify-content-between align-items-center word-card-head">
      <h3 className="fw-bolder text-danger word-card-heading">
        <button
          type="button"
          className="word-card-toggle"
          aria-expanded={isExpanded}
          aria-controls={panelId}
          onClick={() => toggleExpand(keyName)}
        >
          <span className="word-card-name">{result.name || '無資料'}</span>
          <span className="word-card-gloss">{word}</span>
        </button>
      </h3>
      <div className="d-flex align-items-center word-card-actions">
        {hasWordAudio && (
          <Button type="button" variant="link" aria-label={`播放「${result.name}」的發音`} onClick={() => playAudio(result.audioItems[0].fileId)}>
            <FaPlayCircle size={20} className="text-warning" />
          </Button>
        )}
        <Button type="button" variant="link" aria-label={isFavorited ? "取消收藏" : "加入收藏"} aria-pressed={isFavorited} onClick={handleToggleFavorite}>
          {isFavorited ? <FaHeart color="red" /> : <FaRegHeart color="black" />}
        </Button>
      </div>
    </div>
    {isExpanded && (
      <div className="mt-2 pt-2 border-top" id={panelId}>
        <ListGroup variant="flush">
          {result.frequency && <ListGroup.Item><strong>詞頻：</strong><StarRating frequency={result.frequency} /></ListGroup.Item>}
          {result.sources?.length > 0 && <ListGroup.Item><strong>收錄來源：</strong>{Array.isArray(result.sources) ? result.sources.join('、') : result.sources}</ListGroup.Item>}
          {result.variant && <ListGroup.Item><strong>異體詞：</strong>{result.variant}</ListGroup.Item>}
          {result.formationWord && <ListGroup.Item><strong>構詞：</strong>{result.formationWord}</ListGroup.Item>}
          {result.derivativeRoot && <ListGroup.Item><strong>衍生詞根：</strong>{result.derivativeRoot}</ListGroup.Item>}
          {result.dictionaryNote?.replace(/[\r\n]+/g, '') && <ListGroup.Item><strong>備註：</strong>{result.dictionaryNote}</ListGroup.Item>}
          {result.explanationItems?.map((def, i) => (
            <ListGroup.Item key={i}>
              <p className="fw-bolder fs-5 mb-1">{def.chineseExplanation || ''}  {def.englishExplanation || ''}</p>
              {def.category && def.category.length > 0 && <p className="mb-1"><strong>分類：</strong>{def.category}</p>}
              {def.partOfSpeech && def.partOfSpeech.length > 0 && <p className="mb-1"><strong>詞性：</strong>{def.partOfSpeech}</p>}
              {def.focus && def.focus.length > 0 && <p className="mb-1"><strong>焦點：</strong>{def.focus}</p>}
              {def.sentenceItems?.map((ex, ei) => {
                const hasText = ex.originalSentence?.trim() || ex.chineseSentence?.trim();
                if (!hasText) return null;
                const hasNativeAudio = ex.audioItems?.length > 0 && !failedAudio?.has(ex.audioItems[0].fileId);
                // TTS 備用播放：原本寫死「布農語／排灣語」才顯示，改成問後端翻譯能力
                // API 的 hasSentenceAudio（是否已經有整句真人原音）——沒有原音的族語
                // 才需要逐詞串接的 TTS 備用播放鈕，跟 _translate 頁面判斷方式一致。
                const showTtsFallback = !hasNativeAudio && playSentence && !hasSentenceAudio && ex.originalSentence?.trim();
                return (
                  <ListGroup.Item key={`${i}-${ei}`}>
                    <p className="fw-bolder text-danger mb-1">
                      {ex.originalSentence}
                      {hasNativeAudio ? (
                        <Button type="button" variant="link" aria-label="播放例句發音" onClick={() => playAudio(ex.audioItems[0].fileId)}>
                          <FaPlayCircle size={20} className="text-warning" />
                        </Button>
                      ) : showTtsFallback ? (
                        <Button type="button" variant="link" aria-label="播放例句發音" onClick={() => playSentence(ex.originalSentence)}>
                          <FaPlayCircle size={20} className="text-warning" />
                        </Button>
                      ) : null}
                    </p>
                    <p className="fw-bolder mb-1">{ex.chineseSentence}</p>
                    <p className="fw-bolder mb-0">{ex.englishSentence || ''}</p>
                  </ListGroup.Item>
                );
              })}
            </ListGroup.Item>
          ))}
        </ListGroup>
      </div>
    )}
  </ListGroup.Item>
  );
});
WordCard.displayName = "WordCard";

export default WordCard;
