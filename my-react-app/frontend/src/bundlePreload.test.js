// @vitest-environment node
//
// 首頁（dist/index.html）一打開就會預載哪些 JS，直接決定首次載入的流量。
//
// 曾經的問題：vite.config.js 用 manualChunks 把 recharts 與 tiptap 手動拆成 vendor chunk，
// 結果 Rollup 把兩個套件裡「被其他程式碼共用的小模組」放進 vendor chunk，入口 chunk 因此靜態
// import 它們，index.html 對 vendor-recharts（467 KB）與 vendor-tiptap（433 KB）下
// modulepreload：使用者打開首頁就先下載約 900 KB 與首頁無關的程式碼（首頁預載共 2.23 MB）。
// 移除 manualChunks 後降到 1.38 MB。這個測試防止它被改回去。
//
// 需要先有建置結果：CI 的 frontend 工作會先 `npm run build` 再跑測試；本機沒建置過就略過。
import { describe, test, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_HTML = join(ROOT, 'dist', 'index.html');

// 目前約 1.38 MB（入口 + firebase + 少數共用 chunk）。預算留一些空間給正常成長，
// 但擋得住「又把 900 KB 的大型函式庫拉進首頁預載」這種等級的退步。
const PRELOAD_BUDGET_BYTES = 1.7 * 1024 * 1024;

// 只應該在對應路由才下載的大型函式庫（chunk 檔名帶有這些字眼就代表被首頁預載了）
const ROUTE_ONLY_LIBS = /recharts|tiptap|prosemirror/i;

function preloadedScripts() {
  const html = readFileSync(INDEX_HTML, 'utf8');
  const hrefs = [...html.matchAll(/(?:href|src)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  return [...new Set(hrefs)].map((href) => ({
    href,
    bytes: statSync(join(ROOT, 'dist', href)).size,
  }));
}

describe.skipIf(!existsSync(INDEX_HTML))('首頁預載的 JS（需要先 npm run build）', () => {
  test('不預載只有特定路由才會用到的大型函式庫（recharts、tiptap）', () => {
    const offenders = preloadedScripts().filter((s) => ROUTE_ONLY_LIBS.test(s.href)).map((s) => s.href);
    expect(offenders, '這些 chunk 應該只在進入 /note 或圖表頁時才下載').toEqual([]);
  });

  test('首頁預載的 JS 總量在預算內', () => {
    const scripts = preloadedScripts();
    const total = scripts.reduce((sum, s) => sum + s.bytes, 0);
    const detail = scripts.map((s) => `${s.href} ${(s.bytes / 1024).toFixed(0)} KB`).join('\n');
    expect(total, `首頁預載共 ${(total / 1048576).toFixed(2)} MB，超過預算：\n${detail}`).toBeLessThanOrEqual(PRELOAD_BUDGET_BYTES);
  });
});
