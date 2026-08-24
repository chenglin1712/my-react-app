import { useState, useRef, useCallback, useEffect } from "react";
import { apiGet } from "../../utils/apiClient";

/**
 * listening_game.jsx／sentence_game.jsx／pronunciation_game.jsx 共用的「載入題目
 * -> intro/playing/result 狀態機 -> 開始/重來」骨架。三個檔案原本這段幾乎逐行複製，
 * 只有呼叫的 API 路徑跟每次出題數不同。
 *
 * 「這一題怎麼算答對」（選選項 vs 錄音送分比對）跟「結果畫面怎麼彙總分數」
 * （正確率 vs 平均分數）三個遊戲差異太大，不勉強塞進這個 hook，留給呼叫端自己處理；
 * 呼叫端可以用 setAnswers/setCurrent 這些底層 setter 自行組合，也可以在 start()／
 * restart() 回傳後，接著做自己遊戲特有的重置（例如發音練習重置錄音狀態）。
 *
 * generationRef 讓過期的 fetch 回應（切換族語/題數、restart、unmount 之後才回來）
 * 不會再更新 state：同一個遊戲頁面在 React Router 換 :tribe 參數時不一定會重新
 * 掛載，endpoint/tribe/count 改變時要把上一個設定殘留的題目/進度整個歸零，不然
 * 使用者會在新族語的遊戲畫面上看到舊族語的題目或結果。
 */
export function useGameSession({ endpoint, tribe, count }) {
  const [status, setStatus] = useState("intro"); // intro | playing | result
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const generationRef = useRef(0);

  const resetSession = useCallback(() => {
    generationRef.current += 1; // 讓還沒回來的 fetch 變成過期回應
    setStatus("intro");
    setQuestions([]);
    setCurrent(0);
    setAnswers([]);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    resetSession();
  }, [endpoint, tribe, count, resetSession]);

  useEffect(() => {
    return () => { generationRef.current += 1; };
  }, []);

  const fetchQuestions = useCallback(async () => {
    const myGeneration = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet(endpoint, { params: { tribe, count } });
      if (myGeneration !== generationRef.current) return null; // 已經過期，不更新畫面
      if (!Array.isArray(data?.questions)) {
        setError("題目載入失敗，請確認後端伺服器是否啟動。");
        return null;
      }
      setQuestions(data.questions);
      return data.questions;
    } catch {
      if (myGeneration !== generationRef.current) return null;
      setError("題目載入失敗，請確認後端伺服器是否啟動。");
      return null;
    } finally {
      if (myGeneration === generationRef.current) setLoading(false);
    }
  }, [endpoint, tribe, count]);

  // 回傳是否成功開始，讓呼叫端知道要不要接著做自己遊戲特有的重置
  const start = useCallback(async () => {
    if (loading) return false; // 已經有一次請求在進行中，不再觸發第二次
    const qs = await fetchQuestions();
    if (!qs || qs.length === 0) return false;
    setCurrent(0);
    setAnswers([]);
    setStatus("playing");
    return true;
  }, [loading, fetchQuestions]);

  const restart = useCallback(() => {
    resetSession();
  }, [resetSession]);

  // 進到下一題，若已經是最後一題則切到結果畫面
  const goToNext = useCallback(() => {
    if (current + 1 < questions.length) {
      setCurrent((c) => c + 1);
    } else {
      setStatus("result");
    }
  }, [current, questions.length]);

  const progressPct = questions.length ? ((current + 1) / questions.length) * 100 : 0;

  return {
    status, setStatus,
    questions,
    current,
    answers, setAnswers,
    loading,
    error, setError,
    fetchQuestions, start, restart, goToNext,
    progressPct,
  };
}
