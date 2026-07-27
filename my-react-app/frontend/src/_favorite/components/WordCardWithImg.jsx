import { memo, useCallback } from 'react';
import { Button } from 'react-bootstrap';
import { FaHeart, FaRegHeart, FaPlayCircle } from 'react-icons/fa';
import StarRating from '../../../components/ui/StarRating';

const AudioButton = ({ audioUrl, onPlay, size }) => {
  if (!audioUrl) return null;
  return (
    <Button
      variant="link"
      className="audio-button"
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
  const defaultImage = `https://www.shutterstock.com/image-vector/no-image-vector-symbol-missing-260nw-2151420819.jpg`;

  return (
    <div className="word-image-wrapper">
      <img
        src={imageUrl || defaultImage}
        alt={word}
        className="word-image"
        loading="lazy"
      />

      <Button
        variant="link"
        className="favorite-btn"
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

const WordCardInfo = ({ result, word, playAudio, _category }) => (
  <div className="favorite-word-info">
    <h3 className="tayal-word">
      {result.name || '無資料'}
      <AudioButton audioUrl={result.audioItems?.[0]?.fileId} onPlay={playAudio} size={18} />
    </h3>
    <h5 className="chinese-word">{word}</h5>

    <div className="word-meta">
      {result.frequency && (
        <div className="word-frequency-label">
          詞頻：<StarRating frequency={result.frequency} />
        </div>
      )}
      {result.explanationItems && (
  <>
    {result.explanationItems.map((def, i) =>
      def.category && def.category.length > 0 ? (
        <div className="word-category-label" key={i}>
          <span>{def.category}</span>
        </div>
      ) : null
    )}
  </>
)}

    </div>
  </div>
);

//例句組件
const ExampleItem = ({ example, playAudio }) => {
  const hasText = example.originalSentence?.trim() || example.chineseSentence?.trim();
  if (!hasText) return null;

  return (
    <div className="example-item">
      <div className="example-tayal">
        {example.originalSentence}
        <AudioButton audioUrl={example.audioItems?.[0]?.fileId} onPlay={playAudio} size={14} />
      </div>
      <div className="example-ch">{example.chineseSentence}</div>
    </div>
  );
};

//詳情組件
const DefinitionDetails = ({ definitions, playAudio }) => {
  if (!definitions?.length) return null;

  return (
    <div className="definitions-container">
      {definitions.map((def, i) => (
        <div key={i} className="definition-item">
          {def.category && (
            <h6 className="definition-category">
              <strong>例句</strong>
            </h6>
          )}

          {def.sentenceItems?.length > 0 && (
            <div className="examples-container">
              {def.sentenceItems.map((example, ei) => (
                <ExampleItem
                  key={ei}
                  example={example}
                  playAudio={playAudio}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

//單字卡
const WordCardWithImg = memo(({ word, category, result, keyName, isExpanded, toggleExpand, toggleFavorite, wordName, categoryId, playAudio, isFavorited }) => {
  const isFlipped = isExpanded;

  const handleToggleFavorite = useCallback(() => {
    toggleFavorite(wordName, categoryId);
  }, [toggleFavorite, wordName, categoryId]);

  return (
    <div className="word-card-container" key={keyName}>
      <div className={`word-card ${isFlipped ? 'flipped' : ''}`}>
        {/* 正面 */}
        <div className="word-card-front" onClick={() => toggleExpand(keyName)}>
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
              category={category}
            />
          </div>
        </div>

        {/* 背面 */}
        <div className="word-card-back" onClick={() => toggleExpand(keyName)}>
          <div className="word-card-back-header">
            <h4 className="tayal-word-back">
              {result.name || '無資料'}
              <AudioButton audioUrl={result.audioItems?.[0]?.fileId} onPlay={playAudio} size={18} />
            </h4>
            <h5 className="chinese-word-back">{word}</h5>
          </div>

          <div className="word-card-details">
            <DefinitionDetails
              definitions={result.explanationItems}
              playAudio={(url) => {
                playAudio(url);
              }}
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
