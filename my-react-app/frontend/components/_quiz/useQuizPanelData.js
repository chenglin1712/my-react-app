import { useEffect, useState } from "react";
import { uploadQuizDB } from "../../src/userServives/uploadDb";
import { apiGet } from "../../utils/apiClient";

// 依題型把後端原始題目格式整理成要存進資料庫的格式，跟畫面顯示用的欄位對應。
function formatQuestionForUpload(type, q) {
    if (type === "true_false") {
        return {
            question_ab: q.question_ab,
            image: q.image,
            audio: q.audio,
            options: { "1": "O (符合)", "2": "X (不符合)" },
            answer: q.answer,
        };
    }
    if (type === "choice") {
        return {
            question_ab: q.question_ab,
            question_ch: q.question_ch,
            audio: q.audio,
            images: { A: q.imageA, B: q.imageB, C: q.imageC },
            answer: parseInt(q.answer),
        };
    }
    if (type === "matching") {
        return { pairs: q.pairs, answer: q.answer };
    }
    if (type === "cloze") {
        return {
            passage_ab: q.passage_ab,
            passage_ch: q.passage_ch,
            options: q.options,
            answer: parseInt(q.answer),
        };
    }
    return undefined;
}

/**
 * quiz_panel.jsx 的「取得後端測驗資料 -> 整理成要存的格式 -> 寫入資料庫 -> 預先
 * 載入題目圖片」這條資料流程，以及跟著資料一起重置的作答狀態（userAnswers／
 * userStars／currentQuestionIndex，資料重新載入時必須同一時機一起重置，
 * 故意跟資料流程放在同一個 hook，不拆到呼叫端避免時機沒對齊）。
 */
export function useQuizPanelData(level, tribe, level_ch) {
    const [data, setData] = useState([]);
    const [dataLen, setDataLen] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [quizInfo, setQuizInfo] = useState(null);
    const [savedQuestions, setSavedQuestions] = useState([]);
    const [retryCount, setRetryCount] = useState(0);

    const [userAnswers, setUserAnswers] = useState([]);
    const [userStars, setUserStars] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

    //取得後端初級測驗資料
    useEffect(() => {
        let isMounted = true;
        let timeoutId = null;
        async function fetchData() {
            setIsLoading(true);
            try {
                const responseData = await apiGet(import.meta.env.VITE_API_QUIZ_URL, { params: { level, tribe } });
                if (isMounted) {
                    setData(responseData);
                    if (responseData && responseData.parts &&
                        responseData.parts[0] && responseData.parts[0].questions) {
                        // isMounted 只擋住了「排入 setTimeout」這一步，1000ms 後真正
                        // 觸發的 callback 本身既沒有重新檢查 isMounted，清除函式也沒有
                        // 把它 clear 掉。使用者在等待期間快速切換 level／tribe 或連點
                        // 重試（retryCount 變動、這個 effect 重跑），舊的 callback 仍會
                        // 照常觸發，用上一輪的資料把作答進度蓋掉。timeoutId 記下來，
                        // effect 清除時一併 clearTimeout；callback 內再檢查一次
                        // isMounted 當作雙重保險。
                        timeoutId = setTimeout(() => {
                            if (!isMounted) return;
                            const qLen = responseData.parts[0].questions.length;
                            setIsLoading(false);
                            setDataLen(qLen);
                            setUserAnswers(Array(qLen).fill(null));
                            setUserStars(Array(qLen).fill("F"));
                            setCurrentQuestionIndex(0);
                        }, 1000);
                    } else {
                        setIsLoading(false);
                    }
                }
            } catch (error) {
                console.error('取得資料失敗: ', error);
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }
        fetchData();
        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
        };
    }, [level, tribe, retryCount]);

    //測驗資料傳至資料庫
    useEffect(() => {
        if (!data || !data.parts || !data.parts[0]?.questions) return;
        const handlleUploadQuiz = async () => {
            const type = data.parts[0].type;
            const formatted = data.parts[0].questions.map((q) => formatQuestionForUpload(type, q));
            setSavedQuestions(formatted);
            const quiz = await uploadQuizDB(level_ch, formatted, tribe);
            setQuizInfo(quiz);
        };
        handlleUploadQuiz();
    }, [data, level_ch, tribe]);

    //在一開始先加載所有圖片，避免切換題目有延遲
    useEffect(() => {
        if (data?.parts?.[0]?.questions) {
            const type = data.parts[0].type;
            data.parts[0].questions.forEach((q) => {
                if (type === "true_false" && q.image) {
                    const img = new Image();
                    img.src = q.image;
                } else if (type === "choice") {
                    ["imageA", "imageB", "imageC"].forEach((key) => {
                        if (q[key]) {
                            const img = new Image();
                            img.src = q[key];
                        }
                    });
                }
            });
        }
    }, [data]);

    //點擊星星
    const handleStar = () => {
        const updateStars = [...userStars];
        updateStars[currentQuestionIndex] = updateStars[currentQuestionIndex] === "T" ? "F" : "T";
        setUserStars(updateStars);
    };

    //點擊選項
    const handleAnswer = (choice) => {
        const updateAns = [...userAnswers];
        updateAns[currentQuestionIndex] = choice;
        setUserAnswers(updateAns);
    };

    return {
        data, dataLen, isLoading, quizInfo, savedQuestions,
        userAnswers, userStars, currentQuestionIndex, setCurrentQuestionIndex,
        handleStar, handleAnswer,
        retry: () => setRetryCount((c) => c + 1),
    };
}
