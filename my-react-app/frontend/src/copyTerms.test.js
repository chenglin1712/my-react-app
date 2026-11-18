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
export function codeLines(text) {
  // 逐字元掃描並記住目前在哪種區段：字串（' " `）裡的 // 與 /* 不是註解，註解裡的引號也不是字串。
  // 模板字串的 \${ } 內容視為字串的一部分（畫面文字也要檢查，不分裡外）。
  let state = 'code';            // code | line | block | ' | " | `
  const lines = [];
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '\r') continue;
    if (ch === '\n') {
      lines.push(out);
      out = '';
      if (state === 'line' || state === "'" || state === '"') state = 'code';   // 單行字串與行註解到行尾結束
      continue;
    }
    if (state === 'line') continue;
    if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'code'; i += 1; }
      continue;
    }
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; i += 1; continue; }
      if (ch === '/' && next === '*') { state = 'block'; i += 1; continue; }
      if (ch === "'" || ch === '"' || ch === '`') state = ch;
      out += ch;
      continue;
    }
    // 在字串裡
    out += ch;
    if (ch === '\\') { if (next && next !== '\n') { out += next; i += 1; } continue; }
    if (ch === state) state = 'code';
  }
  lines.push(out);
  return lines;
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

describe('copyTerms 的註解剝除', () => {
  it('字串裡的 // 與 /* 不是註解；註解裡的內容不算', () => {
    const src = [
      'const a = "說明 // 點擊這裡";',
      'doThing(); // 保存 在註解裡',
      '/* 發送',
      '   點擊 */ const b = "儲存";',
      "const c = '網址 /* 保存';",
    ].join('\n');
    const out = codeLines(src).join('\n');
    expect(out).toContain('點擊這裡');
    expect(out).toContain('網址 /* 保存');
    expect(out).not.toContain('在註解裡');
    expect(out).not.toContain('發送');
    expect(out).toContain('儲存');
  });
});
