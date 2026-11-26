import { memo, useCallback, useEffect, useRef, useState } from 'react';
import StarRating from '../../../components/ui/StarRating';
import AbstractCover from '../../../components/ui/AbstractCover';
import FavoriteButton from '../../../components/ui/FavoriteButton';
import AudioPlayButton from '../../../components/ui/AudioPlayButton';
import { isAuthFailedAudio } from '../../../hooks/useAuthorizedAudioPlayback';

// 沒有圖片時的抽象封面：依單詞固定挑一個色調（同一個詞每次都一樣），清單看起來有變化但不閃動
const placeholderTone = (word = '') => ([...String(word)].reduce((n, c) => n + c.charCodeAt(0), 0) % 4) + 1;

// FE3-19：改用共用的 AudioPlayButton——名稱含詞名（同頁多顆才分得出來）；播放失敗不再 return null
// 讓按鈕消失（焦點會掉到 body），而是同一顆按鈕變成「重試」。
// audio：{ playAudio, stopAudio, retryAudio, playingId, playingDuration, failedAudio }
const AudioButton = ({ audioUrl, name, audio, size }) => {
  if (!audioUrl) return null;
  const { playAudio, stopAudio, retryAudio, playingId, playingDuration, failedAudio } = audio;
  const playing = playingId === audioUrl;
  return (
    <AudioPlayButton
      name={name || '這個詞'}
      playing={playing}
      duration={playing ? playingDuration : 0}
      failed={Boolean(failedAudio?.has(audioUrl))}
      authRequired={isAuthFailedAudio(failedAudio, audioUrl)}
      onPlay={() => playAudio?.(audioUrl)}
      onStop={() => stopAudio?.()}
      onRetry={() => retryAudio?.(audioUrl)}
      size={size}
    />
  );
};

const WordCardImage = ({ imageUrl, word, isFavorited, onToggleFavorite }) => {
  // 原本用一張 shutterstock.com 的網址當「沒有圖片」的預設圖——那是浮水印
  // 預覽圖，正式環境直接 hotlink 別人的圖床本身就不穩定，也有授權疑慮。改成
  // 純 CSS/圖示的佔位符；圖片網址失效（載入失敗）時也用同一個佔位符頂替，
  // 不會顯示瀏覽器預設的破圖示。
  const [imgFailed, setImgFailed] = useState(false);
  const showPlaceholder = !imageUrl || imgFailed;

  return (
    <div className="word-image-wrapper">
      {showPlaceholder ? (
        <AbstractCover layout="keep" tone={placeholderTone(word)} lite entrance={false} className="word-image word-image-placeholder" />
      ) : (
        <img decoding="async"
          src={imageUrl}
          alt={word}
          className="word-image"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      )}

      {/* 共用的收藏愛心（顏色走 token、aria-pressed、加入時彈跳），不再自己寫死紅與灰。
          愛心是獨立按鈕，不在任何 role=button 裡面（FE3-09）；CSS 讓它疊在「翻面」按鈕的點擊範圍之上。 */}
      <FavoriteButton
        name={word}
        isFavorited={isFavorited}
        size={16}
        className="favorite-btn"
        onToggle={onToggleFavorite}
      />
    </div>
  );
};

const WordCardInfo = ({ result, word, audio, onFlip, flipRef, isFlipped }) => (
  <div className="favorite-word-info">
    <div className="favorite-word-title-row">
      {/* FE3-09：開啟詳情（翻面）的入口是標題裡一顆真正的按鈕（disclosure 模式，比照查詢頁字卡）；
          卡片本身不再是 role=button，愛心與播放鈕是它旁邊獨立的按鈕。 */}
      <h3 className="tayal-word" title={result.name || undefined}>
        <button
          ref={flipRef}
          type="button"
          className="word-card-flip-btn"
          aria-expanded={isFlipped}
          aria-label={`查看「${result.name || '無資料'}」的詳細解釋`}
          onClick={onFlip}
        >
          <span className="tayal-word-text">{result.name || '無資料'}</span>
        </button>
      </h3>
      <AudioButton audioUrl={result.audioItems?.[0]?.fileId} name={result.name} audio={audio} size={18} />
    </div>
    <h5 className="chinese-word" title={word}>{word}</h5>

    <div className="word-meta">
      {/* FE3-19：詞頻 0 或缺值不顯示（原本 {0 && ...} 會渲染出孤立的「0」） */}
      {Number(result.frequency) > 0 && (
        <div className="word-frequency-label">
          詞頻：<StarRating frequency={result.frequency} />
        </div>
      )}
      {result.explanationItems?.map((def, i) =>
        def.category && def.category.length > 0 ? (
          <div className="word-category-label" key={i}>
            <span>{def.category}</span>
          </div>
        ) : null
      )}
    </div>
  </div>
);

//例句組件
const ExampleItem = ({ example, audio }) => {
  const hasText = example.originalSentence?.trim() || example.chineseSentence?.trim();
  if (!hasText) return null;

  return (
    <div className="example-item">
      <div className="example-tayal">
        {example.originalSentence}
        <AudioButton audioUrl={example.audioItems?.[0]?.fileId} name={example.originalSentence?.trim() || example.chineseSentence?.trim()} audio={audio} size={14} />
      </div>
      <div className="example-ch">{example.chineseSentence}</div>
    </div>
  );
};

//詳情組件
const DefinitionDetails = ({ definitions, audio }) => {
  if (!definitions?.length) return null;

  return (
    <div className="definitions-container">
      {definitions.map((def, i) => (
        <div key={i} className="definition-item">
          {def.sentenceItems?.length > 0 && (
            <>
              <h6 className="definition-category">
                <strong>例句</strong>
              </h6>
              <div className="examples-container">
                {def.sentenceItems.map((example, ei) => (
                  <ExampleItem
                    key={ei}
                    example={example}
                    audio={audio}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

//單字卡
const WordCardWithImg = memo(({ word, result, keyName, isExpanded, toggleExpand, toggleFavorite, wordName, categoryId, playAudio, stopAudio, retryAudio, playingId = null, playingDuration = 0, isFavorited, failedAudio }) => {
  const isFlipped = isExpanded;
  const frontBtnRef = useRef(null);
  const backBtnRef = useRef(null);
  const mountedRef = useRef(false);
  // 每次 render 都是新物件沒關係：只有 AudioButton 讀它，而 memo 的比較看的是上面各個 prop
  const audio = { playAudio, stopAudio, retryAudio, playingId, playingDuration, failedAudio };

  // 翻面後原本有焦點的那一面變 inert，焦點會掉到 body，鍵盤使用者就失去位置：
  // 翻面（不是第一次渲染）且焦點掉到 body 時，移到現在可操作的那一面的翻面按鈕。
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (document.activeElement === document.body || document.activeElement === null) {
      (isFlipped ? backBtnRef : frontBtnRef).current?.focus({ preventScroll: true });
    }
  }, [isFlipped]);

  const handleToggleFavorite = useCallback(() => {
    // FE3-10：取消收藏時帶復原提示（toast，可用鍵盤操作並由 live region 報讀），不再讓字卡無聲消失
    toggleFavorite(wordName, categoryId, { undo: true });
  }, [toggleFavorite, wordName, categoryId]);

  const handleToggleExpand = () => toggleExpand(keyName);

  return (
    <div className="word-card-container">
      <div className={`word-card ${isFlipped ? 'flipped' : ''}`}>
        {/* 正面：FE3-09 卡片本身不是 button，互動元件（翻面、愛心、播放）彼此並列、不巢狀 */}
        <div
          className="word-card-front"
          inert={isFlipped}
        >
          <WordCardImage
            imageUrl={result.word_img}
            word={result.name}
            isFavorited={isFavorited}
            onToggleFavorite={handleToggleFavorite}
          />

          <div className="word-card-header">
            <WordCardInfo
              result={result}
              word={word}
              audio={audio}
              onFlip={handleToggleExpand}
              flipRef={frontBtnRef}
              isFlipped={isFlipped}
            />
          </div>
        </div>

        {/* 背面 */}
        <div
          className="word-card-back"
          inert={!isFlipped}
        >
          <div className="word-card-back-header">
            <h4 className="tayal-word-back">
              {result.name || '無資料'}
              <AudioButton audioUrl={result.audioItems?.[0]?.fileId} name={result.name} audio={audio} size={18} />
            </h4>
            <h5 className="chinese-word-back">{word}</h5>
          </div>

          <div className="word-card-details">
            <DefinitionDetails
              definitions={result.explanationItems}
              audio={audio}
            />
          </div>

          {/* 返回按鈕：背面有例句的播放鈕與可捲動區，不能整面當按鈕，所以改成明確的按鈕 */}
          <div className="flip-back-btn">
            <button
              ref={backBtnRef}
              type="button"
              className="word-card-flip-back"
              aria-label={`返回「${result.name || '無資料'}」字卡正面`}
              onClick={handleToggleExpand}
            >
              返回字卡
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
WordCardWithImg.displayName = "WordCardWithImg";

export default WordCardWithImg;
