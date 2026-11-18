import "../../static/css/_game/game_result.css"
import { useEffect, useMemo, useRef } from "react";
import { Alert } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useFavorites } from "../../src/userServives/useFavorites";
import GameResultRecorder from "./GameResultRecorder";
import GameResultSummary from "./GameResultSummary";
import { WORD_FAVORITES_CATEGORY_ID } from "./gameResultStore";

// 「與上次比較」的 localStorage 鍵（讀寫在 GameResultSummary 的 useLastResult）
export const LAST_RESULT_KEY = "yy.game.crossword.lastResult";

const GameResultCard = ({ word, isCorrect, toggleFavorite, isFavorited }) => {
    return (
        <div className="game-result-card-container">
            <div className={`game-result-card ${isCorrect ? 'correct' : 'incorrect'}`}>
                <div className='game-result-card-front'>
                    <div>
                        <h5>{word.clue}</h5>
                    </div>
                    <div>
                        <p className="user-answer">你的答案：{word.user_word || '無答案'}</p>
                        <p className="correct-answer">正確答案：{word.correct_word}</p>
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
            aria-pressed={isFavorited}
        >
            {isFavorited ? '♥' : '♡'}
        </button>
    );
};

/**
 * 顯示填字遊戲的結果
 * @param {object} props
 * @param {object} props.results
 */
const Game_result = ({ results, onRestart, backTo, tribe }) => {
    const { favorites, toggleFavorite, error: favoritesError } = useFavorites();

    // word_details 來自後端，格式不如預期時用空陣列保底，不要讓整個結果頁掛掉。
    const wordDetails = Array.isArray(results?.word_details) ? results.word_details : [];
    const correctWords = wordDetails.filter(word => word.is_correct);
    const incorrectWords = wordDetails.filter(word => !word.is_correct);

    const favoritedWords = useMemo(() => {
        const category = favorites.find(fav => fav.id === WORD_FAVORITES_CATEGORY_ID);
        return new Set(category?.content || []);
    }, [favorites]);

    const totalCount = Number.isFinite(results?.total_words) ? results.total_words : wordDetails.length;
    const pct = totalCount > 0 ? Math.round((correctWords.length / totalCount) * 100) : 0;
    const reviewWords = incorrectWords.map((w) => w.correct_word);
    // 結算畫面一出現就把頁面帶回結果標題（原本沿用作答時的捲動位置，會停在結果中段），並把焦點放在標題。
    // 瞬間捲動、不加動畫：這是畫面切換，不是需要看過程的動作。
    const headingRef = useRef(null);
    useEffect(() => {
        if (!results) return;
        headingRef.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
        headingRef.current?.focus({ preventScroll: true });
    }, [results]);
    if (!results) return null;

    const { total_words, correct_words_count } = results;

    return (
        <div className='result-background'>
            <GameResultRecorder gameId="vocabulary" tribe={tribe} pct={pct} />
            <h2 className='result-title' ref={headingRef} tabIndex={-1}>遊戲結果</h2>
            {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}
            <GameResultSummary
                storageKey={LAST_RESULT_KEY}
                pct={pct}
                correct={correctWords.length}
                total={totalCount}
                unit="個單字"
                reviewWords={reviewWords}
                favoritesApi={{ favorites, toggleFavorite, error: null }}
            />
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
                        <p className="game-result-empty">沒有正確的單字。</p>
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
                        <p className="game-result-empty">沒有錯誤的單字。</p>
                    )}
                </div>
            </div>

            {(onRestart || backTo) && (
                <div className="game-result-actions">
                    {backTo && <Link className="yy-btn-outline" to={backTo}>← 返回遊戲頁面</Link>}
                    {onRestart && <button type="button" className="yy-btn-primary" onClick={onRestart}>再玩一次</button>}
                </div>
            )}
        </div>
    );
};

export default Game_result;
