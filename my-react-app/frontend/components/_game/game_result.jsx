import "../../static/css/_game/game_result.css"
import { useMemo } from "react";
import { Alert } from "react-bootstrap";
import { useFavorites } from "../../src/userServives/useFavorites";

// 單字收藏統一存在 favorites 陣列裡 id === 1 的那個分類（跟 _search/index.jsx、
// _camera/result.jsx 用的是同一個慣例，不是這裡另外發明的）。
const WORD_FAVORITES_CATEGORY_ID = 1;

const GameResultCard = ({ word, isCorrect, toggleFavorite, isFavorited }) => {
    return (
        <div className="game-result-card-container">
            <div className={`game-result-card ${isCorrect ? 'correct' : 'incorrect'}`}>
                <div className='game-result-card-front'>
                    <div>
                        <h5>{word.clue}</h5>
                    </div>
                    <div>
                        <p className="user-answer">你的答案: {word.user_word || '無答案'}</p>
                        <p className="correct-answer">正確答案: {word.correct_word}</p>
                        <div className='result-likebtn'>
                            <LikeButton isFavorited={isFavorited} onToggle={() => toggleFavorite(word.correct_word, WORD_FAVORITES_CATEGORY_ID)} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const LikeButton = ({ isFavorited, onToggle }) => {
    return (
        <button
            type="button"
            onClick={onToggle}
            className='result-likebtn'
            aria-label={isFavorited ? "取消收藏" : "加入收藏"}
        >
            {isFavorited ? '❤️' : '♡'}
        </button>
    );
};

/**
 * 顯示填字遊戲的結果
 * @param {object} props
 * @param {object} props.results
 */
const Game_result = ({ results }) => {
    const { favorites, toggleFavorite, error: favoritesError } = useFavorites();

    // word_details 來自後端，格式不如預期時用空陣列保底，不要讓整個結果頁掛掉。
    const wordDetails = Array.isArray(results?.word_details) ? results.word_details : [];
    const correctWords = wordDetails.filter(word => word.is_correct);
    const incorrectWords = wordDetails.filter(word => !word.is_correct);

    const favoritedWords = useMemo(() => {
        const category = favorites.find(fav => fav.id === WORD_FAVORITES_CATEGORY_ID);
        return new Set(category?.content || []);
    }, [favorites]);

    if (!results) return null;

    const { total_words, correct_words_count } = results;

    return (
        <div className='result-background'>
            <h2 className='result-title'>遊戲結果</h2>
            {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}
            <div className='stats-container'>
                <div className='result-total'>
                    <p>總單字數</p>
                    <p>{total_words}</p>
                </div>
                <div className='result-correct'>
                    <p>正確單字數</p>
                    <p>{correct_words_count}</p>
                </div>
                <div className='result-incorrect'>
                    <p>錯誤單字數</p>
                    <p>{incorrectWords.length}</p>
                </div>
            </div>

            <div>
                <h3 className='result-correctword'>✅ 正確的單字 ({correctWords.length})</h3>
                <div>
                    {correctWords.length > 0 ? (
                        correctWords.map((word, index) => (
                            <GameResultCard
                                key={`${word.correct_word}-${index}`}
                                word={word}
                                isCorrect={true}
                                toggleFavorite={toggleFavorite}
                                isFavorited={favoritedWords.has(word.correct_word)}
                            />
                        ))
                    ) : (
                        <p>沒有正確的單字。</p>
                    )}
                </div>
            </div>

            <div>
                <h3 className='result-incorrectword'>❌ 錯誤的單字 ({incorrectWords.length})</h3>
                <div>
                    {incorrectWords.length > 0 ? (
                        incorrectWords.map((word, index) => (
                            <GameResultCard
                                key={`${word.correct_word}-${index}`}
                                word={word}
                                isCorrect={false}
                                toggleFavorite={toggleFavorite}
                                isFavorited={favoritedWords.has(word.correct_word)}
                            />
                        ))
                    ) : (
                        <p>沒有錯誤的單字。</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Game_result;
