import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// P6-5 微文案守門：畫面上的字不能出現大陸用語。
// 只管「使用者看得到」的字串與 JSX 文字，程式碼註解不管（註解有時要引用舊的說法）。
// 判定用語的依據：專案規則「繁體中文與台灣用語」；台灣也通用的詞（查看、最新消息、類型、了解更多……）不在清單內，不要硬改。
const ROOT = join(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '_admin']);

// [不允許的說法, 改用什麼]
const FORBIDDEN = [
  [/點擊/, '點選（或「點一下」）'],
  [/發送/, '傳送'],
  [/保存(?!期|多久)/, '儲存（資料保存期限、保存多久這類說法除外）'],
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(jsx?|mjs)$/.test(name) && !/\.test\./.test(name)) yield p;
  }
}

// 只留下「程式碼」那部分：去掉行尾註解、單行與跨行的區塊註解（含 JSX 的 {/* */}）。
// 用一個小狀態機逐行處理，狀態 inBlock 表示目前在跨行的 /* ... */ 裡面。
function codeLines(text) {
  let inBlock = false;
  return text.split(/\r?\n/).map((line) => {
    let out = '';
    let rest = line;
    while (rest.length) {
      if (inBlock) {
        const end = rest.indexOf('*/');
        if (end === -1) break;                       // 這一行剩下的都在註解裡
        inBlock = false;
        rest = rest.slice(end + 2);
        continue;
      }
      const block = rest.indexOf('/*');
      const lineComment = rest.search(/(^|\s)\/\//);
      if (lineComment !== -1 && (block === -1 || lineComment < block)) {
        out += rest.slice(0, lineComment);           // 行尾註解：之後都不算
        break;
      }
      if (block === -1) {
        out += rest;
        break;
      }
      out += rest.slice(0, block);
      inBlock = true;
      rest = rest.slice(block + 2);
    }
    return out;
  });
}

describe('畫面文字的台灣用語（P6-5）', () => {
  it('前台程式碼的字串與 JSX 文字沒有大陸用語', () => {
    const hits = [];
    for (const file of walk(ROOT)) {
      codeLines(readFileSync(file, 'utf8')).forEach((code, i) => {
        if (!/[一-鿿]/.test(code)) return;
        for (const [re, instead] of FORBIDDEN) {
          if (re.test(code)) hits.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} 「${re.source}」→ ${instead}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});
