import { memo, useCallback, useState } from 'react';
import { Button } from 'react-bootstrap';
import { FaHeart, FaRegHeart, FaPlayCircle, FaImage } from 'react-icons/fa';
import StarRating from '../../../components/ui/StarRating';

const AudioButton = ({ audioUrl, onPlay, size, failedAudio }) => {
  if (!audioUrl || failedAudio?.has(audioUrl)) return null;
  return (
    <Button
      type="button"
      variant="link"
      className="audio-button"
      aria-label="播放音訊"
      onClick={(e) => {
        e.stopPropagation();
        onPlay(audioUrl);
      }}
    >
      <FaPlayCircle size={size} className="text-warning" />
    </Button>
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
        <div className="word-image word-image-placeholder" aria-hidden="true">
          <FaImage />
        </div>
      ) : (
        <img
          src={imageUrl}
          alt={word}
          className="word-image"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      )}

      <Button
        type="button"
        variant="link"
        className="favorite-btn"
        aria-label={isFavorited ? "取消收藏" : "加入收藏"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
      >
        {isFavorited ? <FaHeart color="#dc2626" /> : <FaRegHeart color="#6b7280" />}
      </Button>
    </div>
  );
};

const WordCardInfo = ({ result, word, playAudio, failedAudio }) => (
  <div className="favorite-word-info">
    <h3 className="tayal-word">
      {result.name || '無資料'}
      <AudioButton audioUrl={result.audioItems?.[0]?.fileId} onPlay={playAudio} size={18} failedAudio={failedAudio} />
    </h3>
    <h5 className="chinese-word">{word}</h5>

    <div className="word-meta">
      {result.frequency && (
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
const ExampleItem = ({ example, playAudio, failedAudio }) => {
  const hasText = example.originalSentence?.trim() || example.chineseSentence?.trim();
  if (!hasText) return null;

  return (
    <div className="example-item">
      <div className="example-tayal">
        {example.originalSentence}
        <AudioButton audioUrl={example.audioItems?.[0]?.fileId} onPlay={playAudio} size={14} failedAudio={failedAudio} />
      </div>
      <div className="example-ch">{example.chineseSentence}</div>
    </div>
  );
};

//詳情組件
const DefinitionDetails = ({ definitions, playAudio, failedAudio }) => {
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
                    playAudio={playAudio}
                    failedAudio={failedAudio}
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
const WordCardWithImg = memo(({ word, result, keyName, isExpanded, toggleExpand, toggleFavorite, wordName, categoryId, playAudio, isFavorited, failedAudio }) => {
  const isFlipped = isExpanded;

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(wordName, categoryId);
  }, [toggleFavorite, wordName, categoryId]);

  const handleToggleExpand = () => toggleExpand(keyName);
  const handleToggleExpandKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggleExpand();
    }
  };

  return (
    <div className="word-card-container">
      <div className={`word-card ${isFlipped ? 'flipped' : ''}`}>
        {/* 正面 */}
        <div
          className="word-card-front"
          role="button"
          tabIndex={0}
          aria-expanded={isFlipped}
          onClick={handleToggleExpand}
          onKeyDown={handleToggleExpandKeyDown}
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
              playAudio={playAudio}
              failedAudio={failedAudio}
            />
          </div>
        </div>

        {/* 背面 */}
        <div
          className="word-card-back"
          role="button"
          tabIndex={0}
          aria-expanded={isFlipped}
          onClick={handleToggleExpand}
          onKeyDown={handleToggleExpandKeyDown}
        >
          <div className="word-card-back-header">
            <h4 className="tayal-word-back">
              {result.name || '無資料'}
              <AudioButton audioUrl={result.audioItems?.[0]?.fileId} onPlay={playAudio} size={18} failedAudio={failedAudio} />
            </h4>
            <h5 className="chinese-word-back">{word}</h5>
          </div>

          <div className="word-card-details">
            <DefinitionDetails
              definitions={result.explanationItems}
              playAudio={playAudio}
              failedAudio={failedAudio}
            />
          </div>

          {/* 返回按鈕 */}
          <div className="flip-back-btn">
            <small className="text-muted">點擊返回</small>
          </div>
        </div>
      </div>
    </div>
  );
});
WordCardWithImg.displayName = "WordCardWithImg";

export default WordCardWithImg;
