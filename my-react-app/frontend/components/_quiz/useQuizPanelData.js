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
/**
 * 這一頁的「身分」——切換等級或族語就是換一份測驗。
 *
 * level_ch 只是 level 的顯示用中文（見 quiz_panel.jsx），不列入身分，
 * 避免同一份測驗因為顯示字串而被誤判成兩份。
 */
const quizKeyOf = (tribe, level) => `${tribe}:${level}`;

export function useQuizPanelData(level, tribe, level_ch) {
    const quizKey = quizKeyOf(tribe, level);

    // 資料連同「它是為了哪一份測驗抓回來的」一起存（FE-10）。原本只存
    // responseData 本身，上傳的 effect 無從得知手上這份資料對應的是哪個
    // 等級／族語，切換等級時就會拿舊題目配新標籤寫進 Firestore。
    const [dataState, setDataState] = useState({ key: null, payload: [] });
    const data = dataState.payload;

    const [dataLen, setDataLen] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [quizInfo, setQuizInfo] = useState(null);
    const [savedQuestions, setSavedQuestions] = useState([]);
    const [retryCount, setRetryCount] = useState(0);
    // uploadQuizDB 失敗時是回傳 null（它自己 catch 掉例外），不會拋出來。
    // 少了這個旗標，quizInfo 會停在 null，使用者按「繳交」時呼叫端的
    // `if (!quizInfo) return;` 只是靜默不動作——畫面沒有任何提示，看起來
    // 就像按鈕壞掉。這裡把失敗顯性化，讓畫面能給出錯誤與重試入口。
    const [uploadFailed, setUploadFailed] = useState(false);

    const [userAnswers, setUserAnswers] = useState([]);
    const [userStars, setUserStars] = useState([]);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

    // 切換測驗的當下就把上一份的 quizInfo／savedQuestions 作廢。
    // quizInfo.ans 是批改用的正確答案、quizInfo.id 是要寫進 situations 的
    // 測驗文件 ID——新測驗還在載入時如果讓舊的 quizInfo 留著，使用者這段
    // 期間按繳交就會用「上一份測驗的答案」批改並記錄。呼叫端
    // （quiz_panel.jsx 的 handleUploadSituation）本來就有 `if (!quizInfo)
    // return;`，清成 null 正好讓繳交在這段期間安全地不動作。
    useEffect(() => {
        setQuizInfo(null);
        setSavedQuestions([]);
        setUploadFailed(false);
    }, [quizKey]);

    //取得後端初級測驗資料
    useEffect(() => {
        let isMounted = true;
        let timeoutId = null;
        async function fetchData() {
            setIsLoading(true);
            try {
                const responseData = await apiGet(import.meta.env.VITE_API_QUIZ_URL, { params: { level, tribe } });
                if (isMounted) {
                    setDataState({ key: quizKey, payload: responseData });
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
    }, [level, tribe, retryCount, quizKey]);

    //測驗資料傳至資料庫
    useEffect(() => {
        // 只有「這份資料是為了目前這份測驗抓回來的」才可以上傳（FE-10）。
        //
        // 這個 effect 會在 level_ch／tribe 改變時立刻重跑，但那個時間點
        // dataState 還是上一份測驗的內容（fetch 還沒回來，也刻意不清空
        // payload，否則畫面會閃一下空白）。少了這道比對，就會用舊題目搭配
        // 新的等級／族語標籤呼叫 uploadQuizDB()；而它用的是 addDoc()——不是
        // upsert——Firestore 會因此真的多出一份「舊題目、貼新標籤」的錯誤
        // 文件，晚到的正確版本再補一份，兩份都留著。
        if (dataState.key !== quizKey) return;
        if (!data || !data.parts || !data.parts[0]?.questions) return;

        // 這裡不能只靠 isMounted：切換等級時元件是「一直掛著」的（路由是
        // /quiz/:level，換等級只是換 params）。要防的是「先發出的上傳比較晚
        // 回來，把新的 quizInfo 蓋掉」，所以用一個屬於這次 effect 執行的旗標，
        // 在 data／測驗身分改變導致 effect 重跑時作廢掉上一次的結果。
        let cancelled = false;
        setUploadFailed(false);

        const handleUploadQuiz = async () => {
            const type = data.parts[0].type;
            const formatted = data.parts[0].questions.map((q) => formatQuestionForUpload(type, q));
            setSavedQuestions(formatted);
            const quiz = await uploadQuizDB(level_ch, formatted, tribe);
            if (cancelled) return;
            setQuizInfo(quiz);
            // uploadQuizDB 內部 catch 之後回傳 null，這裡是唯一能察覺失敗的地方。
            setUploadFailed(!quiz);
        };

        handleUploadQuiz();

        return () => {
            cancelled = true;
        };
    }, [dataState, data, quizKey, level_ch, tribe]);

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
        data, dataLen, isLoading, quizInfo, savedQuestions, uploadFailed,
        userAnswers, userStars, currentQuestionIndex, setCurrentQuestionIndex,
        handleStar, handleAnswer,
        retry: () => setRetryCount((c) => c + 1),
    };
}
