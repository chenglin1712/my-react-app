import { useState, useEffect } from 'react';
import "../../static/css/_game/game_result.css"
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore';

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
    const [favorites, setFavorites] = useState([]);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [db, setDb] = useState(null);
    const [user, setUser] = useState(null);

    useEffect(() => {
        try {
            const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');

            let app;
            if (getApps().length === 0) {
                app = initializeApp(firebaseConfig);
            }
            else {
                app = getApp();
            }

            const auth = getAuth(app);
            const firestoreDb = getFirestore(app);
            setDb(firestoreDb);

            const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
                if (currentUser) {
                    setUser(currentUser);
                }
                else {
                    const __initial_auth_token = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
                    if (__initial_auth_token) {
                        try {
                            await signInWithCustomToken(auth, __initial_auth_token);
                        }
                        catch (error) {
                            console.error("Firebase Custom Token sign-in failed:", error);
                            await signInAnonymously(auth);
                        }
                    }
                    else {
                        await signInAnonymously(auth);
                    }
                }
                setIsAuthReady(true);
            });
            return () => unsubscribe();
        }
        catch (err) {
            console.error("Firebase initialization failed:", err);
        }
    }, []);

    useEffect(() => {
        if (!isAuthReady || !db || !user) {
            return;
        }

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const userDocRef = doc(db, "users", user.uid);

        const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setFavorites(data.favorites || []);
            }
            else {
                setDoc(userDocRef, { favorites: [{ id: 1, content: [] }] }).catch(err => console.error("Failed to create user profile doc:", err));
                setFavorites([]);
            }
        }, (error) => {
            console.error("Error fetching user data:", error);
        });

        return () => unsubscribe();
    }, [isAuthReady, db, user]);

    const toggleFavorite = async (word, categoryId) => {
        if (!user || !db) return;

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const userRef = doc(db, "users", user.uid);

        try {
            const currentFavorites = favorites;
            const categoryIndex = currentFavorites.findIndex(fav => fav.id === categoryId);

            let newFavorites;
            if (categoryIndex > -1) {
                const category = currentFavorites[categoryIndex];
                const content = category.content || [];
                const wordExists = content.includes(word);

                const newContent = wordExists
                    ? content.filter(w => w !== word)
                    : [...content, word];

                newFavorites = [...currentFavorites];
                newFavorites[categoryIndex] = { ...category, content: newContent };
            }
            else {
                newFavorites = [...currentFavorites, { id: categoryId, content: [word] }];
            }

            // 更新資料庫
            await updateDoc(userRef, { favorites: newFavorites });
        }
        catch (err) {
            console.error("收藏操作失敗：", err);
        }
    };

    if (!results) {
        return null;
    }

    const { total_words, correct_words_count, word_details } = results;

    // 將單字分類為正確和錯誤兩組
    const correctWords = word_details.filter(word => word.is_correct);
    const incorrectWords = word_details.filter(word => !word.is_correct);

    const getIsFavorited = (word) => {
        const category1 = favorites.find(fav => fav.id === 1);
        return category1 ? category1.content.includes(word) : false;
    };

    return (
        <div className='result-background'>

            <h2 className='result-title'>
                遊戲結果
            </h2>
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

            {/* 正確的單字列表 */}
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

            {/* 錯誤的單字列表 */}
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
