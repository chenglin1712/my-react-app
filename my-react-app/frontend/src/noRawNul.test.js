import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// F4 守門：原始碼裡不能有原始的 NUL 字元（位元組 0）。
// 以前有兩個檔案把 NUL 直接寫進字串當分隔符號，執行正常，但 git 會把整個檔案當成二進位檔：
// diff 與 PR 看不到內容，審查工具也讀不了。要用 NUL 當分隔符號時，請寫成可見的跳脫 "\u0000"。
const ROOT = join(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);
// 用「排除已知的二進位副檔名」而不是列出文字檔副檔名：以後新增 .ts、.yaml 之類的檔案也會被掃到。
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico|heic|mp3|wav|ogg|m4a|mp4|webm|mov|woff2?|ttf|otf|eot|pdf|zip|gz|wasm)$/i;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (!BINARY_EXT.test(name)) yield p;
  }
}

describe('原始碼不含原始 NUL 字元', () => {
  it('frontend 底下的文字檔沒有位元組 0', () => {
    const offenders = [];
    for (const file of walk(ROOT)) {
      if (readFileSync(file).includes(0)) offenders.push(relative(ROOT, file));
    }
    expect(offenders, '請把原始 NUL 改成可見的 "\\u0000" 跳脫寫法').toEqual([]);
  });

  it('用 \\u0000 當分隔符號的兩個鍵仍然運作（分隔符號不會出現在一般資料裡）', () => {
    const key = (a, b) => `${a}\u0000${b}`;
    expect(key('cat', 'word')).not.toBe(key('ca', 'tword'));   // 沒有分隔符號就會撞在一起
    expect(['a', 'b'].join('\u0000')).toBe('a\u0000b');
  });
});
