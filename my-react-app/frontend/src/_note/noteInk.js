// 筆記文字顏色與字級的選項（選取氣泡用），獨立成 .js 讓元件檔只匯出元件。

// 筆記內容是存下來的資料，所以顏色要寫成實際色碼（不能是 var()）。
// 色碼定義在 theme-v2.css 的 --yy-note-ink-*（資料色，深色模式也不變），這裡只放 token 名稱：
// 畫面上的色票用 var() 取色，按下去時才讀出實際色碼寫進筆記。
export const NOTE_COLORS = [
  { id: "ink", label: "墨黑", token: "--yy-note-ink-ink" },
  { id: "copper", label: "深銅", token: "--yy-note-ink-copper" },
  { id: "olive", label: "橄欖", token: "--yy-note-ink-olive" },
  { id: "green", label: "森綠", token: "--yy-note-ink-green" },
  { id: "indigo", label: "靛藍", token: "--yy-note-ink-indigo" },
  { id: "wine", label: "酒紅", token: "--yy-note-ink-wine" },
];

export const NOTE_SIZES = [
  { id: "small", label: "小", value: "16px" },
  { id: "medium", label: "中", value: "24px" },
  { id: "large", label: "大", value: "32px" },
];

// 色碼可能被瀏覽器正規化成 rgb(...)，統一轉成小寫 #rrggbb 再比對
export function normalizeColor(raw) {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  const m = text.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  return text;
}

// 讀出 token 目前的色碼（正規化成小寫 #rrggbb）；讀不到（樣式還沒載入）回傳 null
export function readInkValue(token) {
  if (typeof document === "undefined") return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return normalizeColor(raw) || null;
}
