// 前端要打的後端路徑，全部從這裡讀。
//
// 為什麼集中：直接寫 `import.meta.env.VITE_API_X_URL` 的地方，只要部署的 .env 少一行，
// 值就是 undefined，請求會打到 `/undefined`（405）或 `fetch("undefined")`，而且只有在正式機才會發現。
// 這裡每個名稱都有預設路徑（與 .env.example、nginx 與 vite proxy 的清單同一份），環境變數有填就用環境變數。
// 預設值與 .env.example 是否一致、有沒有人又直接讀 VITE_API_*，由 apiUrls.test.js 檢查。
//
// 不放在這裡的一個：VITE_API_AI_BOT_STREAM_URL。它是功能開關（空字串＝關閉串流、改走一般請求），
// 不是「缺了要補預設」的網址，bot.jsx 繼續自己讀。
export const API_URL_DEFAULTS = {
  SEARCH_ALL: "/api/v1/dictionary/all/",
  FAVORITES_SUMMARY: "/api/v1/dictionary/favorites-summary/",
  SEARCH_KEY: "/api/v1/dictionary/key/",
  SEARCH_KEYS: "/api/v1/dictionary/keys/",
  SEARCH_AUDIO: "/api/v1/dictionary/audio/",
  SENTENCE_AUDIO: "/api/v1/dictionary/sentence-audio/",
  TRANSLATE: "/api/v1/translation/translate",
  TRANSLATE_CAPABILITIES: "/api/v1/translation/capabilities",
  TRANSLATE_GUEST_QUOTA: "/api/v1/translation/guest-quota",
  TRANSLATE_GUEST_TOKEN: "/api/v1/translation/guest-token",
  MORPHOLOGY_ANALYZE: "/api/v1/morphology/analyze",
  LISTENING_QUESTIONS: "/api/v1/listening/questions",
  SENTENCE_QUESTIONS: "/api/v1/sentence/questions",
  QUIZ: "/crawler/",
  QUIZ_AUDIO: "/api/v1/quiz/compare_audio/",
  GENERATE_QUIZ: "/api/v1/quiz/generate_quiz_frontend",
  SUBMIT_QUIZ_ANSWER: "/api/v1/quiz/submit_answer_frontend",
  RULE_SUMMARY: "/api/v1/quiz/rule_summary",
  RESEARCH_CONSENT: "/api/v1/quiz/research_consent",
  NEWS: "/crawler/news/",
  FEATURES: "/api/v1/features",
  EXAM_SCHEDULE: "/crawler/exam_schedule/",
  AI_BOT: "/AIModel/tayal_chat/",
  REVIEW_BOT: "/AIModel/review_tayal_chat/",
  REVIEW_QUESTION: "/AIModel/review_question/",
  LEARNER_MEMORY: "/AIModel/memory/",
  REPLAN_STUDY_PLAN: "/AIModel/replan_study_plan/",
  VISION: "/api/v1/vision/analyze_image/",
};

// 環境變數有填（去掉空白後不是空字串）就用它，否則 null
export function configuredApiUrl(name) {
  const value = import.meta.env[`VITE_API_${name}_URL`];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function apiUrl(name) {
  const fallback = API_URL_DEFAULTS[name];
  if (fallback === undefined) throw new Error(`apiUrls：沒有「${name}」這個網址名稱`);
  return configuredApiUrl(name) ?? fallback;
}
