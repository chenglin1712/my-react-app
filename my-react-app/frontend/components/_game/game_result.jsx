import "../../static/css/_game/game_result.css"
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useFavorites } from "../../src/userServives/useFavorites";
import GameResultRecorder from "./GameResultRecorder";

// 單字收藏統一存在 favorites 陣列裡 id === 1 的那個分類（跟 _search/index.jsx、
// _camera/result.jsx 用的是同一個慣例，不是這裡另外發明的）。
const WORD_FAVORITES_CATEGORY_ID = 1;

// 「與上次比較」的資料只存在這台裝置的瀏覽器（localStorage），不上傳、不跟帳號綁定；
// 只記一筆：上一次的答對率與時間。讀不到（無痕、被封鎖、第一次玩）就當作沒有上次紀錄。
export const LAST_RESULT_KEY = "yy.game.crossword.lastResult";
const readLast = () => {
    try {
        const v = JSON.parse(localStorage.getItem(LAST_RESULT_KEY));
        return Number.isFinite(v?.pct) ? v : null;
    } catch { return null; }
};
const writeLast = (value) => {
    try { localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(value)); } catch { /* 寫不進去就不比較 */ }
};

const ScoreRing = ({ pct }) => (
    <div className="game-result-ring" style={{ "--ring-pct": pct }}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="game-result-ring-track" cx="50" cy="50" r="44" pathLength="100" />
            <circle className="game-result-ring-fill" cx="50" cy="50" r="44" pathLength="100" />
        </svg>
        <span className="game-result-ring-num">{pct}<small>%</small></span>
    </div>
);

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
    // 上一次的成績要在寫入這一次之前讀好（useState 初始值只跑一次）
    const [last] = useState(readLast);
    const [adding, setAdding] = useState(false);
    useEffect(() => {
        if (results && totalCount > 0) writeLast({ pct, at: Date.now() });
    }, [results, totalCount, pct]);

    // 還沒收藏的錯詞；全部收藏後按鈕改成「已加入」狀態
    // 同一個詞可能在 word_details 出現兩次；toggleFavorite 是切換，必須先去重，不然會收藏又取消
    const pendingWrong = [...new Set(incorrectWords.map((w) => w.correct_word))].filter((word) => !favoritedWords.has(word));
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    const addWrongToFavorites = async () => {
        setAdding(true);
        try {
            for (const word of pendingWrong) {
                if (!mountedRef.current) break;
                await toggleFavorite(word, WORD_FAVORITES_CATEGORY_ID);
            }
        } finally { if (mountedRef.current) setAdding(false); }
    };

    if (!results) return null;

    const { total_words, correct_words_count } = results;
    const diff = last ? pct - last.pct : null;

    return (
        <div className='result-background'>
            <GameResultRecorder gameId="vocabulary" tribe={tribe} pct={pct} />
            <h2 className='result-title'>遊戲結果</h2>
            {favoritesError && <Alert variant="danger">{favoritesError}</Alert>}
            <div className="game-result-summary">
                <ScoreRing pct={pct} />
                <div className="game-result-summary-text">
                    <p className="game-result-headline">答對 {correctWords.length} / {totalCount} 個單字</p>
                    {diff !== null && (
                        <p className="game-result-compare">
                            {diff > 0 ? `比上次進步 ${diff}%` : diff < 0 ? `比上次退步 ${-diff}%` : "與上次相同"}
                            <span>（上次 {last.pct}%）</span>
                        </p>
                    )}
                    {incorrectWords.length > 0 && (
                        <button
                            type="button"
                            className="yy-btn-outline game-result-add-review"
                            onClick={addWrongToFavorites}
                            disabled={adding || pendingWrong.length === 0}
                        >
                            {pendingWrong.length === 0 ? "錯詞都已加入收藏" : adding ? "加入中..." : `把 ${pendingWrong.length} 個錯詞加入收藏複習`}
                        </button>
                    )}
                </div>
            </div>
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
