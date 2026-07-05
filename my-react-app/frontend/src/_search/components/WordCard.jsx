import { ListGroup, Button } from 'react-bootstrap';
import { FaHeart, FaRegHeart, FaPlayCircle } from 'react-icons/fa';

export const renderStars = (fre) => {
  if (fre === null || fre === undefined) return null;
  let starCount = 0;
  if (fre >= 0 && fre <= 50) starCount = 1;
  else if (fre <= 400) starCount = 2;
  else if (fre <= 800) starCount = 3;
  else if (fre <= 1000) starCount = 4;
  else starCount = 5;

  return (
    <>
      {[...Array(starCount)].map((_, i) => (
        <span key={i} >
          <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 640 640"><path fill="#FCC603" d="M341.5 45.1C337.4 37.1 329.1 32 320.1 32C311.1 32 302.8 37.1 298.7 45.1L225.1 189.3L65.2 214.7C56.3 216.1 48.9 222.4 46.1 231C43.3 239.6 45.6 249 51.9 255.4L166.3 369.9L141.1 529.8C139.7 538.7 143.4 547.7 150.7 553C158 558.3 167.6 559.1 175.7 555L320.1 481.6L464.4 555C472.4 559.1 482.1 558.3 489.4 553C496.7 547.7 500.4 538.8 499 529.8L473.7 369.9L588.1 255.4C594.5 249 596.7 239.6 593.9 231C591.1 222.4 583.8 216.1 574.8 214.7L415 189.3L341.5 45.1z" /></svg>
        </span>
      ))}
      {fre && <span style={{ marginLeft: '2px', color: '#666' }}>（{fre}）</span>}
    </>
  );
};

const WordCard = ({ word, result, keyName, expandedWord, toggleExpand, toggleFavorite, playAudio, playSentence, isFavorited, failedAudio, audioAvailable }) => (
  <ListGroup.Item key={keyName} className="d-flex flex-column">
    <div className="d-flex justify-content-between align-items-center">
      <div onClick={() => toggleExpand(keyName)} style={{ cursor: 'pointer', flex: 1 }}>
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
      <Button variant="link" onClick={() => toggleFavorite(keyName)}>
        {isFavorited ? <FaHeart color="red" /> : <FaRegHeart color="black" />}
      </Button>
    </div>
    {expandedWord === keyName && (
      <div className="mt-2 pt-2 border-top">
        <ListGroup variant="flush">
          {result.frequency ? <ListGroup.Item><strong>詞頻：</strong>{renderStars(result.frequency)}</ListGroup.Item> : <></>}
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
                      ) : ex.originalSentence?.trim() && (result.tribe === '布農語' || result.tribe === '排灣語') ? (
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

export default WordCard;
