import { ListGroup, Button } from 'react-bootstrap';
import { CirclePlay } from 'lucide-react';
import StarRating from '../../../components/ui/StarRating';

// 詞條詳情內容：詞頻、來源、異體、構詞、備註、各義項與例句（含音檔）。
// 兩個地方共用：字卡原地展開（_camera 結果頁仍是這種）、單詞查詢的詳情 sheet。
const WordDetailBody = ({ result, playAudio, playSentence, hasSentenceAudio, failedAudio }) => (
  <ListGroup variant="flush">
    {Number(result.frequency) > 0 && <ListGroup.Item><strong>詞頻：</strong><StarRating frequency={result.frequency} /></ListGroup.Item>}
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
              <p className="fw-bolder word-detail-sentence mb-1">
                {ex.originalSentence}
                {hasNativeAudio ? (
                  <Button type="button" variant="link" aria-label="播放例句發音" onClick={() => playAudio(ex.audioItems[0].fileId)}>
                    <CirclePlay size={20} className="yy-icon word-card-icon" aria-hidden="true" />
                  </Button>
                ) : showTtsFallback ? (
                  <Button type="button" variant="link" aria-label="播放例句發音" onClick={() => playSentence(ex.originalSentence)}>
                    <CirclePlay size={20} className="yy-icon word-card-icon" aria-hidden="true" />
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
);

export default WordDetailBody;
