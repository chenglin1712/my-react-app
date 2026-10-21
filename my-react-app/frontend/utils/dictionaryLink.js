// 辭典詞條的連結：搜尋頁讀 ?q=（詞）與 ?tribe=（族語代號）直接查詞（src/_search/index.jsx）。
// AI 助手的視窗是浮在頁面上的，導走會丟掉對話（對話還沒有保存），所以呼叫端一律另開分頁。
export const dictionaryHref = (word, tribe) =>
    `/search?q=${encodeURIComponent(word)}&tribe=${encodeURIComponent(tribe)}`;
