import { memo, useCallback } from 'react';
import { ListGroup, Button } from 'react-bootstrap';
import { FaHeart, FaRegHeart, FaPlayCircle } from 'react-icons/fa';
import StarRating from '../../../components/ui/StarRating';

const WordCard = memo(({ word, result, keyName, isExpanded, toggleExpand, toggleFavorite, wordName, playAudio, playSentence, hasSentenceAudio, isFavorited, failedAudio }) => {
  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(wordName);
  }, [toggleFavorite, wordName]);

  return (
  <ListGroup.Item className="d-flex flex-column">
    <div className="d-flex justify-content-between align-items-center">
      <div
        onClick={() => toggleExpand(keyName)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(keyName); } }}
        style={{ cursor: 'pointer', flex: 1 }}
      >
        <h3 className="fw-bolder text-danger">
          {result.name || '無資料'}
          {result.audioItems?.length > 0 && !failedAudio?.has(result.audioItems[0].fileId) && (
            <Button type="button" variant="link" aria-label="播放音訊" onClick={(e) => { e.stopPropagation(); playAudio(result.audioItems[0].fileId); }}>
              <FaPlayCircle size={20} className="text-warning" />
            </Button>
          )}
        </h3>
        <h5 className="fw-bolder">{word}</h5>
      </div>
      <Button type="button" variant="link" aria-label={isFavorited ? "取消收藏" : "加入收藏"} onClick={handleToggleFavorite}>
        {isFavorited ? <FaHeart color="red" /> : <FaRegHeart color="black" />}
      </Button>
    </div>
    {isExpanded && (
      <div className="mt-2 pt-2 border-top">
        <ListGroup variant="flush">
          {result.frequency && <ListGroup.Item><strong>詞頻：</strong><StarRating frequency={result.frequency} /></ListGroup.Item>}
          {result.sources?.length > 0 && <ListGroup.Item><strong>收錄來源：</strong>{Array.isArray(result.sources) ? result.sources.join('、') : result.sources}</ListGroup.Item>}
          {result.variant && <ListGroup.Item><strong>異體詞：</strong>{result.variant}</ListGroup.Item>}
          {result.formationWord && <ListGroup.Item><strong>構詞：</strong>{result.formationWord}</ListGroup.Item>}
          {result.derivativeRoot && <ListGroup.Item><strong>衍生詞根：</strong>{result.derivativeRoot}</ListGroup.Item>}
          {result.dictionaryNote?.replace(/[\r\n]+/g, '') && <ListGroup.Item><strong>備註：</strong>{result.dictionaryNote}</ListGroup.Item>}
          {result.explanationItems?.map((def, i) => (
            <ListGroup.Item key={i}>
              <h5 className="fw-bolder">{def.chineseExplanation || ''}  {def.englishExplanation || ''}</h5>
              {def.category && def.category.length > 0 && <h6><strong>分類：</strong>{def.category}</h6>}
              {def.partOfSpeech && def.partOfSpeech.length > 0 && <h6><strong>詞性：</strong>{def.partOfSpeech}</h6>}
              {def.focus && def.focus.length > 0 && <h6><strong>焦點：</strong>{def.focus}</h6>}
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
                    <h6 className="fw-bolder text-danger">
                      {ex.originalSentence}
                      {hasNativeAudio ? (
                        <Button type="button" variant="link" aria-label="播放音訊" onClick={() => playAudio(ex.audioItems[0].fileId)}>
                          <FaPlayCircle size={20} className="text-warning" />
                        </Button>
                      ) : showTtsFallback ? (
                        <Button type="button" variant="link" aria-label="播放音訊" onClick={() => playSentence(ex.originalSentence)}>
                          <FaPlayCircle size={20} className="text-warning" />
                        </Button>
                      ) : null}
                    </h6>
                    <h6 className="fw-bolder">{ex.chineseSentence}</h6>
                    <h6 className="fw-bolder">{ex.englishSentence || ''}</h6>
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
