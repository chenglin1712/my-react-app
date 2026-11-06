import { Offcanvas, Button } from 'react-bootstrap';
import { Heart, CirclePlay } from 'lucide-react';
import WordDetailBody from './WordDetailBody';
import '../../../static/css/_search/wordSheet.css';

// 詞條詳情 sheet（Apple 化步驟 4-2）：手機從底部滑出、桌面從右側滑入。
// 用 react-bootstrap 的 Offcanvas，焦點圈住、Esc 關閉、點背景關閉、關閉後焦點回到原本的詞條鈕都由它處理。
const WordDetailSheet = ({
  detail, onClose, isMobile,
  isFavorited, toggleFavorite,
  playAudio, playSentence, hasSentenceAudio, failedAudio,
}) => {
  const result = detail?.result;
  const hasWordAudio = result?.audioItems?.length > 0 && !failedAudio?.has(result.audioItems[0].fileId);

  return (
    <Offcanvas
      show={Boolean(detail)}
      onHide={onClose}
      placement={isMobile ? 'bottom' : 'end'}
      className={`word-sheet word-sheet--${isMobile ? 'bottom' : 'end'}`}
      aria-labelledby="word-sheet-title"
    >
      {result && (
        <>
          <Offcanvas.Header closeButton closeLabel="關閉詳情" className="word-sheet-head">
            <div className="word-sheet-titles">
              <Offcanvas.Title as="h2" id="word-sheet-title" className="word-sheet-name">{result.name || '無資料'}</Offcanvas.Title>
              {detail.word && <p className="word-sheet-gloss">{detail.word}</p>}
            </div>
            <div className="word-sheet-actions">
              {hasWordAudio && (
                <Button type="button" variant="link" aria-label={`播放「${result.name}」的發音`} onClick={() => playAudio(result.audioItems[0].fileId)}>
                  <CirclePlay size={22} className="yy-icon" aria-hidden="true" />
                </Button>
              )}
              <Button type="button" variant="link" aria-label={isFavorited ? '取消收藏' : '加入收藏'} aria-pressed={isFavorited} onClick={() => toggleFavorite(result.name)}>
                <Heart size={22} className="yy-icon" fill={isFavorited ? 'currentColor' : 'none'} aria-hidden="true" />
              </Button>
            </div>
          </Offcanvas.Header>
          <Offcanvas.Body className="word-sheet-body">
            <WordDetailBody
              result={result}
              playAudio={playAudio}
              playSentence={playSentence}
              hasSentenceAudio={hasSentenceAudio}
              failedAudio={failedAudio}
            />
          </Offcanvas.Body>
        </>
      )}
    </Offcanvas>
  );
};

export default WordDetailSheet;
