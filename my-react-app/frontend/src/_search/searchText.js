// 單詞查詢的文字處理：送出前的正規化、比對用的鍵、以字素切字（稽核 FE3-02、FE3-14）。
//
// 族語書寫的撇號（喉塞音）與組合符號（例如 U+0332 底線）是字母的一部分，任何一步都不能刪掉。
// 原則是「比對用正規化鍵，顯示保留原字」：
// - normalizeQuery：送出查詢前只做不改變字形的整理（NFC、全形空白、頭尾與連續空白），
//   畫面上顯示的「找不到『…』」仍是使用者打的字；
// - searchKey：只拿來比對（大小寫、各種撇號、全形字母都視為同一個），跟後端
//   backend/fastAPI/routes/dictionary/normalize.py 的 search_key 同一套規則，改的時候兩邊一起改。

// 各種撇號寫法：’ ‘ ʼ ʻ ʽ ＇ ` ´ ′ ‛。要在 NFKC 之前換成 '，´ 經過 NFKC 會變成「空白＋組合符號」
const APOSTROPHES = /[’‘ʼʻʽ＇`´′‛]/g;

/** 送出查詢前的整理：NFC、全形空白轉半形、連續空白收成一個、去頭尾。不改大小寫、不動撇號與組合符號。 */
export const normalizeQuery = (raw) => String(raw ?? '')
  .normalize('NFC')
  .replace(/\s+/g, ' ') // JS 的 \s 包含全形空白（U+3000）
  .trim();

/** 比對用的鍵：撇號統一 → NFKC（全形字母轉半形）→ 小寫 → NFC → 空白整理。 */
export const searchKey = (raw) => String(raw ?? '')
  .replace(APOSTROPHES, "'")
  .normalize('NFKC')
  .toLowerCase()
  .normalize('NFC')
  .replace(/\s+/g, ' ')
  .trim();

const hasSegmenter = () => typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

/** 以字素（使用者眼中的一個字）切字：n＋U+0332 是一個字，不會被拆成 n 與底線。
 * 沒有 Intl.Segmenter 的瀏覽器退回「基底字元＋後面接著的組合符號」一組，同樣不會切掉組合符號。 */
export const graphemes = (text, { useSegmenter = hasSegmenter() } = {}) => {
  const value = String(text ?? '');
  if (!value) return [];
  if (useSegmenter) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (s) => s.segment);
  }
  return value.match(/\P{M}\p{M}*|\p{M}+/gu) ?? [];
};

/** 關鍵字有沒有中文字（中文查的是詞義，跟族語拼寫的規則不同） */
export const hasHan = (text) => /\p{Script=Han}/u.test(String(text ?? ''));
