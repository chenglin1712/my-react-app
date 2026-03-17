// QuizPage.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
// 如果你使用 Firebase 取得使用者資料，保留以下 import，否則改為你的 user API
import { db } from "../../../firebase";
import { doc, getDoc } from "firebase/firestore";
import { toggleFavoriteWord, authChanges } from "../../src/userServives/userServive";
import axios from 'axios';
// 題型元件（請自行實作或使用現有）
import SentenceFill from "../_test/sentenceFill";
import SentenceOrder from "../_test/sentenceOrder";
import WordMatch from "../_test/wordMatch";
import WordTranslation from "../_test/wordTranslation";

// -------------------------------------------------------------
// === 全域可調參數（你可以依需求調整）
// -------------------------------------------------------------
const ALPHA0 = 1; // 貝葉斯平滑 alpha0
const BETA0 = 1;  // 貝葉斯平滑 beta0

// 3PL 猜測度（4選1題設為0.25）
const DEFAULT_GUESS = 0.25;

// 題型區分度 a_q（可調）
const TYPE_AQ = {
  "word-translate": 1.2,
  "word-match": 1.0,
  "sentence-fill": 0.9,
  "sentence-order": 1.1,
};

// IRT 更新學習率 γ
const LEARNING_RATE = 0.08;

// 題目難度合成權重 α, β, γ （alpha for Dw, beta for Dt, gamma for freq term）
const DQ_ALPHA = 0.45;
const DQ_BETA  = 0.35;
const DQ_GAMMA = 0.20; // alpha+beta+gamma = 1

// 學習附加分數 B_q 權重 (beta1..beta5). 之和應為 1
const BETA1 = 0.2; // 收藏 F_w
const BETA2 = 0.2; // 探索度 R_w
const BETA3 = 0.2; // 錯誤率變化 Δ_w
const BETA4 = 0.2; // 作答時間 T_w
const BETA5 = 0.2; // 詞頻 f'(w)

// 題目總數固定 10 題
const TOTAL_QUESTIONS = 10;

// -------------------------------------------------------------
// === 輔助：題型渲染
// -------------------------------------------------------------
function QuestionRenderer({ question, selected, checked, onSelect, onConfirm }) {
  switch (question.type) {
    case "sentence-fill":
      return (
        <SentenceFill
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
    case "sentence-order":
      return (
        <SentenceOrder
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
    case "word-match":
      return (
        <WordMatch
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
    case "word-translate":
      return (
        <WordTranslation
          question={question}
          selected={selected}
          checked={checked}
          onSelect={onSelect}
          onConfirm={onConfirm}
        />
      );
    default:
      return <p>未知題型</p>;
  }
}

// -------------------------------------------------------------
// === 公式實作區塊（每一個函數下方都有註解指出哪個數學公式）
// -------------------------------------------------------------

/* 1) 詞頻標準化
   f'(w) = ln(1 + f(w)) / max_{u in V} ln(1 + f(u))
*/
function computeNormalizedFreq(wordList) {
  const logVals = wordList.map((w) => Math.log(1 + (w.frequency || 0)));
  const maxLog = Math.max(...logVals, 1); // 防止除以 0
  const map = {};
  wordList.forEach((w, i) => {
    map[w.name] = Math.log(1 + (w.frequency || 0)) / maxLog;
  });
  return map; // { wordName: fPrime }
}

/* 2) 貝葉斯平滑錯誤率 (Dw, Dt)
   Dw = (e_w + alpha0) / (n_w + alpha0 + beta0)
   Dt = (e_t + alpha0) / (n_t + alpha0 + beta0)
*/
function computeSmoothedErrorRate(e, n, alpha0 = ALPHA0, beta0 = BETA0) {
  return ( (e || 0) + alpha0 ) / ( (n || 0) + alpha0 + beta0 );
}

/* 3) 題目錯誤率 D_q 與 b_w:
   D_q = alpha * D_w + beta * D_t + gamma * (1 - f'(w))
   b_w = ln( D_q / (1 - D_q) )
*/
function computeDqAndBw(Dw, Dt, fPrime, alpha = DQ_ALPHA, beta = DQ_BETA, gamma = DQ_GAMMA) {
  const Dq = alpha * Dw + beta * Dt + gamma * (1 - fPrime);
  // clip Dq 到 (eps, 1-eps) 避免 log(0)
  const eps = 1e-6;
  const DqClipped = Math.min(Math.max(Dq, eps), 1 - eps);
  const bw = Math.log(DqClipped / (1 - DqClipped));
  return { Dq: DqClipped, bw };
}

/* 4) 3PL IRT 預測答對機率 P(theta):
   P(theta) = C + (1 - C) / (1 + e^{-a_q (theta - b_w)})
*/
function computePtheta(theta, bw, a_q = 1, C = DEFAULT_GUESS) {
  const ex = Math.exp(-a_q * (theta - bw));
  return C + (1 - C) / (1 + ex);
}

/* 5) 使用者能力更新:
   theta_new = theta_old + gamma * (C - P(theta))
   其中 C = 1 if correct else 0
*/
function updateTheta(thetaOld, correct, Ptheta, gamma = LEARNING_RATE) {
  const thetaNew = thetaOld + gamma * ((correct ? 1 : 0) - Ptheta);
  // 可將 theta 範圍限制到某區間，例如 -3..+3 或 0..1。此範例我們用 0..1
  return Math.min(Math.max(thetaNew, 0), 1);
}

/* 6) 錯誤率 recent 與 delta_w:
   D_recent = (e1+...+e5)/5
   D_total = e_w / n_w
   delta_w = D_recent / D_total (若 D_total==0, 設為1)
*/
function computeDeltaW(recentResults /* array of 0/1 */, e_w, n_w) {
  const len = recentResults?.length || 0;
  const D_recent = len ? recentResults.reduce((a,b) => a + b, 0) / len : 0.5; // 若無 recent 預設 0.5
  const D_total = n_w ? (e_w / n_w) : 0.5; // 若無總次數預設 0.5
  return D_total === 0 ? 1 : D_recent / D_total;
}

/* 7) 作答時間 T_w:
   t_w = 平均作答時間 (recent_times 平均)
   T_w = t_w / t_avg
*/
function computeTw(recentTimes = [], tAvgAll = 1) {
  if (!recentTimes || recentTimes.length === 0) return 1; // 預設 1
  const t_w = recentTimes.reduce((a,b) => a + b, 0) / recentTimes.length;
  return t_w / Math.max(tAvgAll, 1e-6);
}

/* 8) 學習附加分數 B_q:
   B_q = (beta1*F_w + beta2*R_w + beta3*Delta_w + beta4*T_w + beta5*f'(w)) / sum(beta...)
   這裡假設 sum(beta)=1
*/
function computeBq(F_w, R_w, Delta_w, T_w, fPrime, b1=BETA1, b2=BETA2, b3=BETA3, b4=BETA4, b5=BETA5) {
  const numerator = b1*F_w + b2*R_w + b3*Delta_w + b4*T_w + b5*fPrime;
  const denom = (b1 + b2 + b3 + b4 + b5) || 1;
  return numerator / denom;
}

/* 9) 題目總分 Score_w (用來排序選題)：
     Score_w = P(theta) * B_q  （一個可選擇的設計）
   你也可以把 Score 改為 P(theta) * (1 + B_q) 或其他形式
*/
function computeScore(Ptheta, Bq) {
  return Ptheta * (1 + Bq); // (1+Bq) 讓 Bq 作為加成 (Bq 可負可正視情況而定)
}

// -------------------------------------------------------------
// === 主要元件：QuizPage
// -------------------------------------------------------------
export default function QuizPage({ uid }) {
  const navigate = useNavigate();

  // state
  const [loading, setLoading] = useState(true);
  const [wordList, setWordList] = useState([]); // 從 /all/ 取得的完整詞庫
  const [questionList, setQuestionList] = useState([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(false);
  const [totalTime, setTotalTime] = useState(0);
  const [questionTime, setQuestionTime] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [userModel, setUserModel] = useState({
    ability: 0.5, // theta 初始值 (0..1)
    user_errors: {}, // per-word data
    type_stats: {
      // 題型錯誤統計（e_t, n_t），需要在作答時更新
      "word-translate": { e: 0, n: 0 },
      "word-match": { e: 0, n: 0 },
      "sentence-fill": { e: 0, n: 0 },
      "sentence-order": { e: 0, n: 0 },
    },
    // optional: 收藏 / 探索度 / 其他 user metadata
    favorites: {}, // { wordName: true }
    explorations: {}, // { wordName: score(0..1) }
  });

  // 計時器
  useEffect(() => {
    const timer = setInterval(() => {
      setTotalTime(t => t + 1);
      setQuestionTime(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  
  //畫面尺寸判斷
  useEffect(() => {
      const checkScreenSize = () => {
        setIsMobile(window.innerWidth < 768);
      };
      checkScreenSize();
      window.addEventListener('resize', checkScreenSize);
      return () => window.removeEventListener('resize', checkScreenSize);
    }, []);

  // 讀取使用者資料 & 單詞庫
  useEffect(() => {
    async function loadAll() {
      try {
        // 1) 取 user_errors (from Firebase 或你的 user API)
        let userErrorsFromDb = {};
        try {
          const userSnap = await getDoc(doc(db, "users", uid));
          const userData = userSnap.exists() ? userSnap.data() : {};
          userErrorsFromDb = userData.user_errors || {};
          // 若 userData 有 favorites/explorations 可載入
          setUserModel(prev => ({ ...prev, user_errors: userErrorsFromDb, favorites: userData.favorites || {}, explorations: userData.explorations || {} }));
        } catch (e) {
          // 若沒有 Firebase，請自行以 API 取得 user_errors
          console.warn("無法從 Firebase 取得 user，請確認設定或改寫此段", e);
        }

        // 2) 從後端 /all/ 取得完整詞庫
        res = await axios.post('http://127.0.0.1:8001/dictionary/all/');
        console.log('API回傳(search):', res.data);
        const allWords = [];
        if (res.data?.all_results) {
          Object.values(data.all_results).forEach(arr => {
            arr.forEach(w => allWords.push(w));
          });
        }
        setWordList(allWords);

        // 3) 依照公式計算並產生題目（固定 TOTAL_QUESTIONS）
        const questions = await generateQuestions({ ...userModel, user_errors: userErrorsFromDb }, allWords);
        setQuestionList(questions);
      } catch (err) {
        console.error("載入失敗", err);
      } finally {
        setLoading(false);
      }
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // 產生題目的核心函數（會用到上面所有公式）
  async function generateQuestions(user, allWords) {
    // 0) 前處理：詞頻正規化 f'(w)
    const fPrimeMap = computeNormalizedFreq(allWords); // f'(w)

    // 1) 計算使用者平均作答時間 t_avg (從 user_errors 建立)
    //    如果沒有資料，設為 1 秒避免除以零
    const allAvgTimes = [];
    Object.entries(user.user_errors || {}).forEach(([wn, d]) => {
      if (d?.recent_times && d.recent_times.length) {
        const avg = d.recent_times.reduce((a,b) => a + b, 0) / d.recent_times.length;
        if (Number.isFinite(avg)) allAvgTimes.push(avg);
      }
    });
    const tAvgAll = allAvgTimes.length ? (allAvgTimes.reduce((a,b) => a + b, 0) / allAvgTimes.length) : 1;

    // 2) 計算每個單詞的 Score:
    //    - 先計 Dw, Dt（貝葉斯平滑）
    //    - 再算 D_q 與 b_w
    //    - 再算 P(theta)
    //    - 再算 Delta_w, T_w, B_q
    //    - 最後 Score = P(theta) * (1 + B_q)（可以依需要變更）
    const theta = user.ability ?? 0.5;
    const wordsWithScores = allWords.map(w => {
      const name = w.name;
      // user word stats
      const ue = (user.user_errors && user.user_errors[name]) || { attempts: 0, errors: 0, recent_results: [], recent_times: [] };
      const e_w = ue.errors || 0;
      const n_w = ue.attempts || 0;
      const recent_results = ue.recent_results || [];
      const recent_times = ue.recent_times || [];

      // Dw (單詞錯誤率) => 貝葉斯平滑公式
      const Dw = computeSmoothedErrorRate(e_w, n_w, ALPHA0, BETA0);

      // Dt (題型錯誤率) => 使用 user.type_stats 的資料計算（預設若無則 50%）
      // 為了評估每個可能題型，這裡我們計算一個平均 Dt（或可針對每題型分別計算）
      // 在這裡示範按題型計算（以 word-translate 為例，實際生成該題型時會再用該題型 Dt）
      const Dt_map = {};
      Object.entries(user.type_stats || {}).forEach(([tName, st]) => {
        Dt_map[tName] = computeSmoothedErrorRate(st.e || 0, st.n || 0, ALPHA0, BETA0);
      });

      // f'(w)
      const fPrime = fPrimeMap[name] ?? 0;

      // 我們會為每個題型計算 b_w 與 Ptheta，再在 generateQuestions 時套用題型特定值
      return {
        raw: w,
        Dw,
        Dt_map,
        fPrime,
        recent_results,
        recent_times,
        e_w,
        n_w,
        // 先暫時計算一個基礎 difficulty (可視為採 word-translate 題型的 Dq)
        base: (() => {
          const Dt_example = Dt_map["word-translate"] ?? 0.5;
          const { Dq, bw } = computeDqAndBw(Dw, Dt_example, fPrime, DQ_ALPHA, DQ_BETA, DQ_GAMMA);
          const a_q = TYPE_AQ["word-translate"] || 1;
          const Ptheta = computePtheta(theta, bw, a_q, DEFAULT_GUESS);
          // Delta_w, T_w, B_q
          const Delta_w = computeDeltaW(recent_results, e_w, n_w);
          const T_w = computeTw(recent_times, tAvgAll);
          const F_w = (user.favorites && user.favorites[name]) ? 1 : 0;
          const R_w = (user.explorations && user.explorations[name]) ? user.explorations[name] : 0;
          const Bq = computeBq(F_w, R_w, Delta_w, T_w, fPrime);
          const Score = computeScore(Ptheta, Bq);
          return { Dq, bw, Ptheta, Bq, Score, Delta_w, T_w };
        })()
      };
    });

    // 3) 選題策略：
    //    - 我們希望產生 TOTAL_QUESTIONS = 10 題
    //    - 依使用者能力分配題型比例（與你前面要求一致）
    const ratios =
      theta < 0.4
        ? { translate: 0.5, match: 0.3, fill: 0.1, order: 0.1 }
        : theta < 0.7
        ? { translate: 0.3, match: 0.2, fill: 0.25, order: 0.25 }
        : { translate: 0.2, match: 0.1, fill: 0.3, order: 0.4 };

    const typeCount = {
      wordTranslate: Math.round(TOTAL_QUESTIONS * ratios.translate),
      wordMatch: Math.round(TOTAL_QUESTIONS * ratios.match),
      sentenceFill: Math.round(TOTAL_QUESTIONS * ratios.fill),
      sentenceOrder: Math.round(TOTAL_QUESTIONS * ratios.order),
    };
    // 調整總數避免四捨五入誤差
    const totalAssigned = Object.values(typeCount).reduce((a,b) => a + b, 0);
    if (totalAssigned < TOTAL_QUESTIONS) typeCount.wordTranslate += (TOTAL_QUESTIONS - totalAssigned);

    // 依 Score 排序，取前面許多候選再分配題型（避免直接按前10導致題型比例不平衡）
    const sortedByScore = wordsWithScores.sort((a,b) => b.base.Score - a.base.Score);

    const generated = [];
    let idx = 0;

    // Helper: pop next best unused word
    const usedNames = new Set();
    function nextBest() {
      while(idx < sortedByScore.length && usedNames.has(sortedByScore[idx].raw.name)) idx++;
      if (idx >= sortedByScore.length) return null;
      const wsc = sortedByScore[idx++];
      usedNames.add(wsc.raw.name);
      return wsc;
    }

    // -- word-translate (四選一)
    for (let i=0;i<typeCount.wordTranslate;i++){
      const wsc = nextBest();
      if (!wsc) break;
      const w = wsc.raw;
      // 重新計算 Dq & bw 使用題型對應的 Dt
      const Dt = wsc.Dt_map["word-translate"] ?? 0.5;
      const { Dq, bw } = computeDqAndBw(wsc.Dw, Dt, wsc.fPrime);
      const a_q = TYPE_AQ["word-translate"] || 1;
      const Ptheta = computePtheta(theta, bw, a_q, DEFAULT_GUESS);
      // 生成 3 個干擾選項
      const otherOpts = allWords
        .filter(o => o.name !== w.name)
        .sort(() => Math.random() - 0.5)
        .slice(0,3)
        .map(o => o.explanationItems?.[0]?.chineseExplanation ?? "未知");
      const correctCN = w.explanationItems?.[0]?.chineseExplanation ?? "未知";
      const options = [correctCN, ...otherOpts].sort(() => Math.random() - 0.5);

      // B_q 計算
      const Delta_w = computeDeltaW(wsc.recent_results, wsc.e_w, wsc.n_w);
      const T_w = computeTw(wsc.recent_times, tAvgAll);
      const F_w = (user.favorites && user.favorites[w.name]) ? 1 : 0;
      const R_w = (user.explorations && user.explorations[w.name]) ? user.explorations[w.name] : 0;
      const Bq = computeBq(F_w, R_w, Delta_w, T_w, wsc.fPrime);

      generated.push({
        id: `wt-${w.id || w.name}-${i}`,
        type: "word-translate",
        tayal: { word: w.name, audio: w.audioItems?.[0]?.fileId },
        cn: correctCN,
        options,
        answer: correctCN,
        difficulty: bw, // IRT 的 b_w
        meta: { Ptheta, Bq, Dq }
      });
    }

    // -- word-match (每題 5 個單詞)
    for (let i=0;i<typeCount.wordMatch;i++){
      // 從未用過的詞中挑 5 個（以 score 前段為主）
      const pairs = [];
      for (let j=0;j<5;j++){
        const wsc = nextBest();
        if (!wsc) break;
        const w = wsc.raw;
        pairs.push({
          cn: w.explanationItems?.[0]?.chineseExplanation ?? "未知",
          tayal: { word: w.name, audio: w.audioItems?.[0]?.fileId }
        });
      }
      if (pairs.length > 0) {
        generated.push({
          id: `wm-${i}`,
          type: "word-match",
          pairs,
          difficulty: null
        });
      }
    }

    // -- sentence-fill
    for (let i=0;i<typeCount.sentenceFill;i++){
      const wsc = nextBest();
      if (!wsc) break;
      const w = wsc.raw;
      const example = w.explanationItems?.[0]?.sentenceItems?.[0];
      const options = example?.anaphoraSentence?.slice(0,4).map(a => ({ word: a.anaphoraItems?.[0]?.name ?? "", audio: w.audioItems?.[0]?.fileId ?? "" })) ?? [];
      generated.push({
        id: `sf-${w.id || w.name}-${i}`,
        type: "sentence-fill",
        sentence: example?.originalSentence?.replace(w.name, "___") ?? "___",
        options,
        answer: w.name,
        difficulty: null
      });
    }

    // -- sentence-order (中文句子 -> 排序族語單詞)
    for (let i=0;i<typeCount.sentenceOrder;i++){
      const wsc = nextBest();
      if (!wsc) break;
      const w = wsc.raw;
      const example = w.explanationItems?.[0]?.sentenceItems?.[0];
      const words = example?.anaphoraSentence?.filter(a => !a.isSymbol).map(a => ({ word: a.anaphoraItems?.[0]?.name ?? "" })) ?? [];
      const answer = words.map(o => o.word);
      generated.push({
        id: `so-${w.id || w.name}-${i}`,
        type: "sentence-order",
        sentenceCn: example?.chineseSentence ?? "未知句子",
        words,
        answer,
        difficulty: null
      });
    }

    // 若生成題數不足，從剩下候選補齊 (以簡單類型為主)
    while (generated.length < TOTAL_QUESTIONS && idx < sortedByScore.length) {
      const wsc = nextBest();
      if (!wsc) break;
      const w = wsc.raw;
      const correctCN = w.explanationItems?.[0]?.chineseExplanation ?? "未知";
      generated.push({
        id: `fillpad-${w.name}-${generated.length}`,
        type: "word-translate",
        tayal: { word: w.name, audio: w.audioItems?.[0]?.fileId },
        options: [correctCN].concat(allWords.filter(o => o.name !== w.name).slice(0,3).map(o => o.explanationItems?.[0]?.chineseExplanation ?? "未知")).sort(() => Math.random() - 0.5),
        answer: correctCN,
        difficulty: null
      });
    }

    // 最終回傳题目陣列 (長度應為 TOTAL_QUESTIONS)
    return generated.slice(0, TOTAL_QUESTIONS);
  } // end generateQuestions

  // 使用者作答按鈕處理（下一題）
  const handleNext = () => {
    if (!selected) return;
    const isCorrect = selected?.result; // 子元件應回傳 { result: boolean, ... }
    const currentQ = questionList[current];
    // determine wordKey (有些題型沒有 tayal，使用 answer)
    const wordKey = currentQ.tayal?.word || currentQ.answer || (currentQ.pairs && currentQ.pairs[0]?.tayal?.word) || "unknown";

    // deep copy userModel
    const newModel = JSON.parse(JSON.stringify(userModel));

    // 更新 type_stats (e_t, n_t) for current question's type
    if (!newModel.type_stats) newModel.type_stats = {};
    if (!newModel.type_stats[currentQ.type]) newModel.type_stats[currentQ.type] = { e: 0, n: 0 };
    newModel.type_stats[currentQ.type].n += 1;
    if (!isCorrect) newModel.type_stats[currentQ.type].e += 1;

    // 更新 user_errors (attempts, errors, recent_results, recent_times, avg_time)
    if (!newModel.user_errors[wordKey]) {
      newModel.user_errors[wordKey] = {
        attempts: 0,
        errors: 0,
        recent_results: [],
        recent_times: [],
        avg_time: 0
      };
    }
    const ue = newModel.user_errors[wordKey];
    ue.attempts += 1;
    if (!isCorrect) ue.errors += 1;
    ue.recent_results.push(isCorrect ? 0 : 1);
    if (ue.recent_results.length > 5) ue.recent_results.shift();
    ue.recent_times.push(questionTime);
    if (ue.recent_times.length > 5) ue.recent_times.shift();
    ue.avg_time = ue.recent_times.reduce((a,b) => a + b, 0) / ue.recent_times.length;

    // 依照 3PL 與更新規則計算 P(theta) 與更新 theta
    // 需要用該題的 b_w 與 a_q:
    let bw = (typeof currentQ.difficulty === "number") ? currentQ.difficulty : 0; // 若沒有 difficulty，視為 0 (中等)
    const a_q = TYPE_AQ[currentQ.type] || 1;
    const Ptheta = computePtheta(newModel.ability, bw, a_q, DEFAULT_GUESS);
    const thetaNew = updateTheta(newModel.ability, isCorrect, Ptheta, LEARNING_RATE);
    newModel.ability = thetaNew;

    // persist model to state
    setUserModel(newModel);

    // reset selection, push to answers, advance
    setSelected(null);
    setChecked(false);
    setQuestionTime(0);
    if (current + 1 < questionList.length) {
      setCurrent(current + 1);
    } else {
      // 完成測驗，導向結果頁 (你可依需求傳 userModel)
      navigate("../result", {
        state: {
          totalTime,
          userModel: newModel
        }
      });
    }
  };

  if (loading) return <p className="text-center mt-10">載入中...</p>;

  return (
    <div className="w-full max-w-3xl bg-white shadow-xl rounded-2xl p-8 flex flex-col items-center" style={{ minHeight: "calc(100vh - 110px)" }}>
      <div className="w-full self-stretch bg-gray-200 rounded-full h-3 mb-4 overflow-hidden">
        <div className="bg-green-500 h-3 transition-[width] duration-500" style={{ width: `${((current + 1) / questionList.length) * 100}%` }} />
      </div>

      <h6 className="text-sm text-gray-600 mb-2 text-center">第 {current + 1} / {questionList.length} 題</h6>

      <QuestionRenderer
        question={questionList[current]}
        selected={selected}
        checked={checked}
        onSelect={(val) => setSelected(val)}
        onConfirm={() => setChecked(true)}
      />

      <div className="w-full flex justify-center mt-6">
        <button onClick={handleNext} className={`custom-btn mt-3 ${!checked ? "opacity-50 cursor-not-allowed" : ""}`} disabled={!checked}>
          {current === questionList.length - 1 ? "結束測驗" : "下一題"}
        </button>
      </div>
    </div>
  );
}
