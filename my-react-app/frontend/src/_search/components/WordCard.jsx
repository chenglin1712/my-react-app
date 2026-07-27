import { memo, useCallback } from 'react';
import { ListGroup, Button } from 'react-bootstrap';
import { FaHeart, FaRegHeart, FaPlayCircle } from 'react-icons/fa';
import StarRating from '../../../components/ui/StarRating';

const WordCard = memo(({ word, result, keyName, isExpanded, toggleExpand, toggleFavorite, wordName, playAudio, playSentence, isFavorited, failedAudio, audioAvailable = true }) => {
  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(wordName);
  }, [toggleFavorite, wordName]);

  return (
  <ListGroup.Item key={keyName} className="d-flex flex-column">
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
          {audioAvailable && result.audioItems?.length > 0 && !failedAudio?.has(result.audioItems[0].fileId) ? (
            <Button variant="link" aria-label="播放音訊" onClick={(e) => { e.stopPropagation(); if (result.audioItems?.length) playAudio(result.audioItems[0].fileId); }}>
              <FaPlayCircle size={20} className="text-warning" />
            </Button>
          ) : (<></>)}
        </h3>
        <h5 className="fw-bolder">{word}</h5>
      </div>
      <Button variant="link" onClick={handleToggleFavorite}>
        {isFavorited ? <FaHeart color="red" /> : <FaRegHeart color="black" />}
      </Button>
    </div>
    {isExpanded && (
      <div className="mt-2 pt-2 border-top">
        <ListGroup variant="flush">
          {result.frequency ? <ListGroup.Item><strong>詞頻：</strong><StarRating frequency={result.frequency} /></ListGroup.Item> : <></>}
          {result.sources?.length > 0 ? <ListGroup.Item><strong>收錄來源：</strong>{Array.isArray(result.sources) ? result.sources.join('、') : result.sources}</ListGroup.Item> : <></>}
          {result.variant ? <ListGroup.Item><strong>異體詞：</strong>{result.variant || ''}</ListGroup.Item> : <></>}
          {result.formationWord ? <ListGroup.Item><strong>構詞：</strong>{result.formationWord || ''}</ListGroup.Item> : <></>}
          {result.derivativeRoot ? <ListGroup.Item><strong>衍生詞根：</strong>{result.derivativeRoot || ''}</ListGroup.Item> : <></>}
          {result.dictionaryNote?.replace(/[\r\n]+/g, '') ? <ListGroup.Item><strong>備註：</strong>{result.dictionaryNote || ''}</ListGroup.Item> : <></>}
          {result.explanationItems?.map((def, i) => (
            <ListGroup.Item key={i}>
              <h5 className="fw-bolder">{def.chineseExplanation || ''}  {def.englishExplanation || ''}</h5>
              {def.category && def.category.length > 0 ? <h6><strong>分類：</strong>{def.category || ''}</h6> : <></>}
              {def.partOfSpeech && def.partOfSpeech.length > 0 ? <h6><strong>詞性：</strong>{def.partOfSpeech || ''}</h6> : <></>}
              {def.focus && def.focus.length > 0 ? <h6><strong>焦點：</strong>{def.focus || ''}</h6> : <></>}
              {def.sentenceItems?.map((ex, ei) => {
                const hasText = ex.originalSentence?.trim() || ex.chineseSentence?.trim();
                if (!hasText) return null;
                const hasNativeAudio = audioAvailable && ex.audioItems?.length > 0 && !failedAudio?.has(ex.audioItems[0].fileId);
                return (
                  <ListGroup.Item key={`${i}-${ei}`}>
                    <h6 className="fw-bolder text-danger">
                      {ex.originalSentence}
                      {hasNativeAudio ? (
                        <Button variant="link" aria-label="播放音訊" onClick={() => playAudio(ex.audioItems[0].fileId)}>
                          <FaPlayCircle size={20} className="text-warning" />
                        </Button>
                      ) : playSentence && ex.originalSentence?.trim() && (result.tribe === '布農語' || result.tribe === '排灣語') ? (
                        <Button variant="link" aria-label="播放音訊" onClick={() => playSentence(ex.originalSentence)}>
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
