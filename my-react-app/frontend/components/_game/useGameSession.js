import { useState } from "react";
import axios from "axios";
import { auth } from "../../../firebase";

/**
 * listening_game.jsx／sentence_game.jsx／pronunciation_game.jsx 共用的「載入題目
 * -> intro/playing/result 狀態機 -> 開始/重來」骨架。三個檔案原本這段幾乎逐行複製，
 * 只有呼叫的 API 路徑跟每次出題數不同。
 *
 * 「這一題怎麼算答對」（選選項 vs 錄音送分比對）跟「結果畫面怎麼彙總分數」
 * （正確率 vs 平均分數）三個遊戲差異太大，不勉強塞進這個 hook，留給呼叫端自己處理；
 * 呼叫端可以用 setAnswers/setCurrent 這些底層 setter 自行組合，也可以在 start()／
 * restart() 回傳後，接著做自己遊戲特有的重置（例如發音練習重置錄音狀態）。
 */
export function useGameSession({ endpoint, tribe, count }) {
  const [status, setStatus] = useState("intro"); // intro | playing | result
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchQuestions = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await axios.get(`${endpoint}?tribe=${tribe}&count=${count}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setQuestions(res.data.questions);
      return res.data.questions;
    } catch {
      setError("題目載入失敗，請確認後端伺服器是否啟動。");
      return null;
    } finally {
      setLoading(false);
    }
  };

  // 回傳是否成功開始，讓呼叫端知道要不要接著做自己遊戲特有的重置
  const start = async () => {
    const qs = await fetchQuestions();
    if (!qs || qs.length === 0) return false;
    setCurrent(0);
    setAnswers([]);
    setStatus("playing");
    return true;
  };

  const restart = () => {
    setStatus("intro");
    setQuestions([]);
    setCurrent(0);
    setAnswers([]);
  };

  // 進到下一題，若已經是最後一題則切到結果畫面
  const goToNext = () => {
    if (current + 1 < questions.length) {
      setCurrent((c) => c + 1);
    } else {
      setStatus("result");
    }
  };

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
