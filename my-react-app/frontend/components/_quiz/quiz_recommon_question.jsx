import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiPost } from "../../utils/apiClient";
import { useAuth } from "../../src/userServives/authContext";
import { loadQuizModel, saveQuizModel } from "./quizModelService";
import { getWordNameForQuestion, buildResultAnalysis } from "./quizResultAnalysis";
import QuestionRenderer, { QUESTION_COMPONENTS } from "./quiz_recommon_question_renderer";
import "../../static/css/_quiz/quiz_recommon_question.css";

export default function RecommendedQuizQuestion({ tribe = "tayal" }) {
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
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [saveWarning, setSaveWarning] = useState("");

  // 計時
  const [totalTime, setTotalTime] = useState(0);
  const [questionTime, setQuestionTime] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // 切換族語／使用者身分就是換一份新的測驗——上一份測驗殘留的作答進度、
    // 計時、IRT 模型都要歸零，不然新題目載入後可能沿用舊測驗的 current／
    // answers／計時，current 甚至可能超出新題數。
    setCurrent(0);
    setChecked(false);
    setSelected(null);
    setUserAnswers([]);
    setTotalTime(0);
    setQuestionTime(0);
    setSaveWarning("");
    userModelRef.current = {};

    const loadQuiz = async () => {
      if (!userData?.uid) return;
      setLoading(true);
      setLoadError(null);
      try {
        const storedModel = await loadQuizModel(userData.uid);
        if (cancelled) return;
        userModelRef.current = storedModel;

        const data = await apiPost(
          import.meta.env.VITE_API_GENERATE_QUIZ_URL,
          storedModel,
          { params: { tribe } }
        );
        if (cancelled) return;

        // canonical 的 id/type/difficulty/meta 要放在 payload 之後展開，
        // 不然如果 payload 裡剛好也帶了同名欄位，會因為物件字面量後寫的
        // 屬性覆蓋前面，把這裡指定的正確值蓋掉。
        const flat = (data.questions || []).map((q) => ({
          ...q.payload,
          id: q.id,
          type: q.type,
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

  // 題目載入完成、且真的有題目可作答才開始計時——原本只看 loading，
  // 載入失敗或題目為空時（loading 也會變 false）計時器仍會在錯誤畫面
  // 背後繼續累加。
  useEffect(() => {
    if (loading || loadError || questionList.length === 0) return;
    const timer = setInterval(() => {
      setTotalTime((t) => t + 1);
      setQuestionTime((t) => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, loadError, questionList.length]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleNext = async () => {
    // isAdvancing 防止快速連點「下一題」造成同一題答案被記錄兩次、
    // 同一次作答送兩次 API。
    if (!selected || isAdvancing) return;
    setIsAdvancing(true);

    try {
      // 使用各題型回傳的正確狀態
      const isCorrect = selected?.result;

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
          correctAnswer: selected.correctAnswer,
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
        // 原本這裡失敗只 console，畫面完全不會顯示——使用者以為這次的
        // 學習進度有存到，實際上適性出題的模型沒有更新到。不擋下作答流程
        // （不然使用者會因為分析服務的問題被卡住），但要讓他們知道。
        console.error("提交答題紀錄失敗:", err.data ?? err.message);
        setSaveWarning("這次的作答結果可能沒有真的存進學習模型，適性出題可能不會反映最新進度。");
      }

      if (current + 1 < questionList.length) {
        setCurrent(current + 1);
        setChecked(false);
        setSelected(null);
        setQuestionTime(0); // 下一題時間歸零
      } else {
        // 測驗結束，把最新的學習模型寫回 Firestore，下次測驗才能接續進度
        let modelSaveFailed = false;
        if (userData?.uid) {
          try {
            await saveQuizModel(userData.uid, userModelRef.current);
          } catch (err) {
            console.error("儲存學習模型失敗:", err.message);
            modelSaveFailed = true;
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
            modelSaveFailed,
          },
        });
      }
    } finally {
      setIsAdvancing(false);
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

  const currentQuestion = questionList[current];

  // 後端回傳了目前無法呈現的題型時，與其讓使用者卡在一個「下一題」永遠
  // disabled 的畫面（未知題型沒有辦法呼叫 onConfirm），不如提供明確的
  // 離開出口。是否應該改成「跳過這一題」由產品決定，這裡先不臆測。
  if (!QUESTION_COMPONENTS[currentQuestion.type]) {
    return (
      <div
        className="w-full max-w-3xl bg-white shadow-xl rounded-2xl p-8 flex flex-col items-center justify-center"
        style={{ minHeight: "calc(100vh - 110px)" }}
      >
        <p>這一題的題型暫時無法顯示，請返回測驗選單重新開始。</p>
        <button type="button" className="custom-btn mt-3" onClick={() => navigate("..")}>
          返回測驗選單
        </button>
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-3xl bg-white shadow-xl rounded-2xl p-8 flex flex-col items-center"
      style={{ minHeight: "calc(100vh - 110px)" }}
    >
      {/* 進度條 */}
      <div
        className="w-full self-stretch bg-gray-200 rounded-full h-3 mb-4 overflow-hidden"
        role="progressbar"
        aria-label="作答進度"
        aria-valuemin="0"
        aria-valuemax={questionList.length}
        aria-valuenow={current + 1}
      >
        <div
          className="bg-green-500 h-3 transition-[width] duration-500"
          style={{ width: `${((current + 1) / questionList.length) * 100}%` }}
        />
      </div>

      <h6 className="text-sm text-gray-600 mb-2 text-center">
        第 {current + 1} / {questionList.length} 題
      </h6>

      {saveWarning && (
        <p className="quiz-recommon-save-warning" role="alert" style={{ color: '#d32f2f', textAlign: 'center', marginBottom: '8px' }}>
          {saveWarning}
        </p>
      )}

      {/* 題目區 */}
      <div className="flex flex-col items-center justify-center w-full overflow-auto">
        <QuestionRenderer
          // 題型元件（尤其 SentenceOrder／SentenceSpeak／WordMatch）自己持有一份
          // 只在掛載時初始化、或沒被完整重設的本地狀態（拖曳排序的字庫、錄音結果、
          // 配對進度……）。連續兩題剛好是同一種題型時 React 會沿用同一個元件實體，
          // 沒有 key 的話上一題的殘留狀態會被新題目繼承。用 key 強制每一題都重新掛載，
          // 跟 quiz_panel.jsx 的 MatchingQuestion 用 key={currentQuestionIndex} 是同一招。
          key={`${current}:${currentQuestion.id}`}
          question={currentQuestion}
          selected={selected}
          checked={checked}
          onSelect={(val) => setSelected(val)}
          onConfirm={() => { setChecked(true); }}
        />
      </div>

      {/* 下一題按鈕 */}
      <div className="w-full flex justify-center mt-6" style={{ textAlign: "center" }}>
        <button
          onClick={handleNext}
          className={`custom-btn mt-3 ${!checked || isAdvancing ? "opacity-50 cursor-not-allowed" : ""}`}
          disabled={!checked || isAdvancing}
          style={{ cursor: !checked || isAdvancing ? "not-allowed" : "pointer" }}
        >
          {current === questionList.length - 1 ? "結束測驗" : "下一題"}
        </button>
      </div>
    </div>
  );
}
