import "../../static/css/_game/game_result.css"
import { useFavorites } from "../../src/userServives/useFavorites";

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
                            <LikeButton isFavorited={isFavorited} onToggle={() => toggleFavorite(word.correct_word, 1)} />
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
    const { favorites, toggleFavorite } = useFavorites();

    if (!results) return null;

    const { total_words, correct_words_count, word_details } = results;
    const correctWords = word_details.filter(word => word.is_correct);
    const incorrectWords = word_details.filter(word => !word.is_correct);

    const getIsFavorited = (word) => {
        const category1 = favorites.find(fav => fav.id === 1);
        return category1 ? category1.content.includes(word) : false;
    };

    return (
        <div className='result-background'>
            <h2 className='result-title'>遊戲結果</h2>
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
                                key={index}
                                word={word}
                                isCorrect={true}
                                toggleFavorite={toggleFavorite}
                                isFavorited={getIsFavorited(word.correct_word)}
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
                                key={index}
                                word={word}
                                isCorrect={false}
                                toggleFavorite={toggleFavorite}
                                isFavorited={getIsFavorited(word.correct_word)}
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
