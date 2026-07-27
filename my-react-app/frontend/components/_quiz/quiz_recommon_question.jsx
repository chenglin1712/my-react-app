import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../../utils/apiClient";
import { useAuth } from "../../src/userServives/authContext";
import { loadQuizModel, saveQuizModel } from "./quizModelService";
import { getWordNameForQuestion, buildResultAnalysis } from "./quizResultAnalysis";
import QuestionRenderer from "./quiz_recommon_question_renderer";
import "../../static/css/_quiz/quiz_recommon_question.css";

export default function QuizPage({ tribe = "tayal" }) {
  const { userData } = useAuth();
  const navigate = useNavigate();

  const [questionList, setQuestionList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // 使用者的 IRT 學習模型（ability/user_errors/type_stats...），從 Firestore
  // users/{uid}.quiz_model 讀入，測驗過程中逐題更新，結束時寫回，
  // 讓下一次測驗的出題難度延續這一次的結果。放在 ref 而非 state：
  // 這份資料只餵給後端 API，不影響畫面渲染，不需要觸發 re-render。
  const userModelRef = useRef({});

  const [current, setCurrent] = useState(0);
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState(null);
  const [userAnswers, setUserAnswers] = useState([]);

  // 計時
  const [totalTime, setTotalTime] = useState(0);
  const [questionTime, setQuestionTime] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadQuiz = async () => {
      if (!userData?.uid) return;
      setLoading(true);
      setLoadError(null);
      try {
        const storedModel = await loadQuizModel(userData.uid);
        userModelRef.current = storedModel;

        const data = await apiPost(
          import.meta.env.VITE_API_GENERATE_QUIZ_URL,
          storedModel,
          { params: { tribe } }
        );
        if (cancelled) return;

        const flat = (data.questions || []).map((q) => ({
          id: q.id,
          type: q.type,
          ...q.payload,
          difficulty: q.difficulty,
          meta: q.meta,
        }));
        setQuestionList(flat);
      } catch (err) {
        console.error("載入薦讀測驗題目失敗:", err.data ?? err.message);
        if (!cancelled) setLoadError("題目載入失敗，請稍後再試。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadQuiz();
    return () => { cancelled = true; };
  }, [userData?.uid, tribe]);

  // 題目載入完成才開始計時，避免把載入等待的時間也算進總花費時間
  useEffect(() => {
    if (loading) return;
    const timer = setInterval(() => {
      setTotalTime((t) => t + 1);
      setQuestionTime((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [loading]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleNext = async () => {
    if (!selected) return; // 未答題，不進行下一題

    // 使用各題型回傳的正確狀態
    const isCorrect = selected?.result ;

    // 更新答題紀錄，加入 questionTime
    const currentQ = questionList[current];
    const updatedAnswers = [
      ...userAnswers,
      {
        id: currentQ.id,
        type: currentQ.type,
        question: selected.question,
        answer: selected.answer,
        userAnswer: selected.userAnswer,
        correct: isCorrect,
        correctAnswer:selected.correctAnswer,
        timeSpent: questionTime, // ✅ 記錄作答時間
      },
    ];
    setUserAnswers(updatedAnswers);

    // 把這題的作答結果送回 IRT 引擎，更新 ability/user_errors，
    // 下一次 generate_quiz_frontend（不論是這次測驗還是下一次）都會依最新結果出題
    try {
      const data = await apiPost(
        import.meta.env.VITE_API_SUBMIT_QUIZ_ANSWER_URL,
        {
          user_data: userModelRef.current,
          answer: {
            question_id: currentQ.id,
            question_type: currentQ.type,
            word_name: getWordNameForQuestion(currentQ),
            correct: !!isCorrect,
            time_spent: questionTime,
          },
        },
        { params: { tribe } }
      );
      userModelRef.current = data.user_model;
    } catch (err) {
      console.error("提交答題紀錄失敗:", err.data ?? err.message);
    }

    if (current + 1 < questionList.length) {
      setCurrent(current + 1);
      setChecked(false);
      setSelected(null);
      setQuestionTime(0); // 下一題時間歸零
    } else {
      // 測驗結束，把最新的學習模型寫回 Firestore，下次測驗才能接續進度
      if (userData?.uid) {
        try {
          await saveQuizModel(userData.uid, userModelRef.current);
        } catch (err) {
          console.error("儲存學習模型失敗:", err.message);
        }
      }

      // 測驗結束 → 導向結果頁
      const correctCount = updatedAnswers.filter((a) => a.correct).length;
      const accuracy = Math.round((correctCount / questionList.length) * 100);
      const { analysis, suggestion } = buildResultAnalysis(updatedAnswers);

      navigate("../result", {
        state: {
          totalTime: formatTime(totalTime),
          accuracy,
          userAnswers: updatedAnswers,
          analysis,
          suggestion,
        },
      });
    }
  };

  if (loading) {
    return (
      <div
        className="w-full max-w-3xl bg-white shadow-xl rounded-2xl p-8 flex flex-col items-center justify-center"
        style={{ minHeight: "calc(100vh - 110px)" }}
      >
        <p>題目載入中，請稍候...</p>
      </div>
    );
  }

  if (loadError || questionList.length === 0) {
    return (
      <div
        className="w-full max-w-3xl bg-white shadow-xl rounded-2xl p-8 flex flex-col items-center justify-center"
        style={{ minHeight: "calc(100vh - 110px)" }}
      >
        <p>{loadError || "目前沒有可用的題目，請稍後再試。"}</p>
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-3xl bg-white shadow-xl rounded-2xl p-8 flex flex-col items-center"
      style={{ minHeight: "calc(100vh - 110px)" }}
    >
      {/* 進度條 */}
      <div className="w-full self-stretch bg-gray-200 rounded-full h-3 mb-4 overflow-hidden">
        <div
          className="bg-green-500 h-3 transition-[width] duration-500"
          style={{ width: `${((current + 1) / questionList.length) * 100}%` }}
        />
      </div>

      <h6 className="text-sm text-gray-600 mb-2 text-center">
        第 {current + 1} / {questionList.length} 題
      </h6>

      {/* 題目區 */}
      <div className="flex flex-col items-center justify-center w-full overflow-auto">
        <QuestionRenderer
          question={questionList[current]}
          selected={selected}
          checked={checked}
          onSelect={(val) => setSelected(val)}
          onConfirm={() => {setChecked(true);}}
        />
      </div>

      {/* 下一題按鈕 */}
      {current < questionList.length && (
        <div className="w-full flex justify-center mt-6" style={{ textAlign: "center" }}>
          <button
            onClick={handleNext}
            className={`custom-btn mt-3 ${!checked ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={!checked}
            style={{ cursor: !checked ? "not-allowed" : "pointer" }}
          >
            {current === questionList.length - 1 ? "結束測驗" : "下一題"}
          </button>
        </div>
      )}
    </div>
  );
}
