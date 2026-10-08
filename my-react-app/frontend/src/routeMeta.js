// 前台各頁的瀏覽器分頁標題。原本整站只有 index.html 的一個固定標題「源·語」，
// 分頁、瀏覽紀錄與螢幕報讀器都分不出現在是哪一頁。
// 比對順序由上到下，精確路徑要排在較短的前綴之前。後台（/admin）的標題由
// AdminLayout 依麵包屑自己設定，這裡不處理。
export const SITE_NAME = '源·語';

const TITLE_RULES = [
  { test: (p) => p === '/', title: `${SITE_NAME}｜五族語言學習平台` },
  { test: (p) => p === '/search', title: '單詞查詢' },
  { test: (p) => p === '/translate', title: '翻譯' },
  { test: (p) => p.startsWith('/camera'), title: '影像辨識' },
  { test: (p) => p === '/favorite', title: '收藏' },
  { test: (p) => p.startsWith('/game'), title: '遊戲專區' },
  { test: (p) => p === '/quiz/select', title: '選擇測驗族語' },
  { test: (p) => p.startsWith('/quiz'), title: '測驗' },
  { test: (p) => p === '/bot', title: 'AI 助手' },
  { test: (p) => p === '/note/share', title: '筆記分享區' },
  { test: (p) => p.startsWith('/note'), title: '寫筆記' },
  { test: (p) => p.startsWith('/share/'), title: '分享的筆記' },
  { test: (p) => p === '/login', title: '登入' },
  { test: (p) => p === '/register', title: '註冊' },
  { test: (p) => p === '/forgot', title: '忘記密碼' },
  { test: (p) => p === '/reset', title: '重設密碼' },
  { test: (p) => p === '/edit', title: '編輯個人資料' },
  { test: (p) => p === '/calendar', title: '行事曆' },
  { test: (p) => p === '/admin-login', title: '後台登入' },
];

/** 取得路徑對應的完整分頁標題。找不到對應規則就是不存在的網址（404）。 */
export function getPageTitle(pathname) {
  const rule = TITLE_RULES.find(({ test }) => test(pathname));
  if (!rule) return `找不到頁面｜${SITE_NAME}`;
  return rule.title.includes(SITE_NAME) ? rule.title : `${rule.title}｜${SITE_NAME}`;
}
