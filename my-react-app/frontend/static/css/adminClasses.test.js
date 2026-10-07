// @vitest-environment node
//
// 後台通用元件（admin-*）的守門測試：
//   1. src/_admin 的 JSX 用到的每一個 admin-* class，都必須在 static/css/_admin 底下至少有一條規則；
//      改名或刪規則時漏改 JSX，頁面會悄悄失去樣式，這裡直接擋下。
//   2. 後台頁面（系統、遊戲、待驗證佇列）不得再借用題庫的 quiz-bank-* class（見 _admin/README.md）。
import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN_CSS = join(HERE, '_admin');
const ADMIN_SRC = join(HERE, '..', '..', 'src', '_admin');

function walk(dir, ext) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, ext);
    return ext.some((e) => name.endsWith(e)) && !name.includes('.test.') ? [full] : [];
  });
}

const cssText = walk(ADMIN_CSS, ['.css']).map((f) => readFileSync(f, 'utf8')).join('\n');
const jsxFiles = walk(ADMIN_SRC, ['.jsx']);

describe('後台通用元件 class', () => {
  test('JSX 用到的 admin-* class 都有對應的 CSS 規則', () => {
    const missing = new Set();
    for (const file of jsxFiles) {
      const source = readFileSync(file, 'utf8');
      for (const [, value] of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        // 只看靜態的 class 字串；樣板字串裡的 ${…} 先拿掉
        const text = (value ?? '').replace(/\$\{[^}]*\}/g, ' ');
        for (const token of text.split(/\s+/)) {
          if (/^admin-[a-z0-9-]+$/.test(token) && !new RegExp(`\\.${token}(?![\\w-])`).test(cssText)) missing.add(token);
        }
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  test('系統、遊戲、待驗證佇列不借用題庫的 quiz-bank-* class', () => {
    const files = [
      'system/FeatureFlags.jsx', 'system/CacheManagement.jsx', 'system/RateLimitSettings.jsx',
      'system/MorphologyCapabilities.jsx', 'verification/VerificationQueue.jsx', 'games/GameSettings.jsx',
    ];
    const offenders = files.filter((f) => /quiz-bank/.test(readFileSync(join(ADMIN_SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
