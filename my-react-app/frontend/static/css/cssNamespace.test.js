// @vitest-environment node
//
// 全站 CSS 都是全域的：兩個檔案用同一個類別名稱定義規則，實際樣式取決於哪個檔案
// 後載入（lazy 載入的頁面更是「後到者贏」），而且切換頁面也不會卸載舊的樣式。
// AI 助手整頁無法操作的問題就是 bot.css 與 Navbar.css 都定義了 .overlay。
// 這個測試擋下兩種情況：
//   1. 用 .overlay／.message 這類過於通用的名稱定義頂層規則
//   2. 新增「跨檔案同名」的頂層類別（既有的列在 KNOWN_DUPLICATES，清掉一個就從清單移除）
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const CSS_ROOT = dirname(fileURLToPath(import.meta.url));

// 這些名稱太通用，一定會和別的檔案撞名；請加上功能前綴（例如 .bot-overlay）。
const BANNED_GENERIC = ['.overlay', '.message', '.avatar', '.status', '.modal', '.container', '.wrapper', '.content', '.item'];

// 截至這個測試建立時已經存在的跨檔案同名類別。不要往裡面新增，應該改類別名稱；
// 清掉其中一個之後請把它從這裡移除。
const KNOWN_DUPLICATES = [
  '.btn-primary', '.close-btn', '.event-card', '.formTitle', '.home-title', '.icon',
  '.required-mark', '.result-title', '.submit-actions', '.submit-button', '.word-cards-grid',
];

function listCss(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listCss(full);
    return full.endsWith('.css') ? [full] : [];
  });
}

// 頂層、只有單一類別（可帶一個偽類別）的選擇器，例如 `.name {` 或 `.name:hover {`
function topLevelClasses(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set();
  for (const m of stripped.matchAll(/^(\.[A-Za-z_][\w-]*)(?::[\w-]+)?\s*\{/gm)) names.add(m[1]);
  return names;
}

const definitions = new Map(); // 類別名稱 -> 檔案清單
for (const file of listCss(CSS_ROOT)) {
  const shortName = relative(CSS_ROOT, file).split(/[\\/]/).join('/');
  for (const name of topLevelClasses(readFileSync(file, 'utf8'))) {
    if (!definitions.has(name)) definitions.set(name, []);
    definitions.get(name).push(shortName);
  }
}

describe('全域 CSS 類別命名', () => {
  test('沒有檔案用過於通用的名稱定義頂層規則', () => {
    const offenders = BANNED_GENERIC.filter((n) => definitions.has(n))
      .map((n) => `${n}（${definitions.get(n).join('、')}）`);
    expect(offenders, '請改成帶功能前綴的名稱，例如 .bot-overlay').toEqual([]);
  });

  test('沒有新增跨檔案同名的頂層類別', () => {
    const duplicates = [...definitions].filter(([, files]) => new Set(files).size > 1).map(([n]) => n).sort();
    const added = duplicates.filter((n) => !KNOWN_DUPLICATES.includes(n));
    expect(added, '這些類別在多個 CSS 檔都有定義，請改名避免互相覆蓋').toEqual([]);
  });

  test('KNOWN_DUPLICATES 裡已經消失的項目要移除，清單才不會過期', () => {
    const stale = KNOWN_DUPLICATES.filter((n) => !(definitions.get(n) && new Set(definitions.get(n)).size > 1));
    expect(stale).toEqual([]);
  });
});
