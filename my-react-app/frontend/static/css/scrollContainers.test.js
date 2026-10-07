// @vitest-environment node
//
// 防止「頁面容器變成第二個捲動容器」：CSS 的 overflow-x: hidden 會讓 overflow-y 自動變成 auto，
// 整頁外層元素就成了自己的捲動容器，右側出現兩條捲軸（尚未進場的區塊用 translateY 位移時，內容超出
// 一點點就會觸發）。擋橫向溢出要用 overflow-x: clip（只裁切、不建立捲動容器）。
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const THEME = join(dirname(fileURLToPath(import.meta.url)), 'default', 'theme-v2.css');

describe('整頁容器不能是捲動容器', () => {
  test('.yy-page 用 overflow-x: clip 擋橫向溢出，最後生效的宣告不是 hidden', () => {
    const css = readFileSync(THEME, 'utf8');
    const block = css.match(/^\.yy-page\s*\{([^}]*)\}/m);
    expect(block, '找不到 .yy-page 規則').not.toBeNull();
    const declarations = [...block[1].matchAll(/overflow(?:-x)?\s*:\s*([a-z-]+)/g)].map((m) => m[1]);
    expect(declarations.at(-1)).toBe('clip');
  });
});
