import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// F7 守門：品牌名稱統一為「原語」。
// 舊寫法「源·語」（半形中點 U+00B7）與「源・語」（全形中點 U+30FB）曾同時出現在分頁標題、
// PWA 安裝名稱、離線頁與後台，和畫面上的「原語」字標不一致。
const PROJECT = join(import.meta.dirname, '..', '..');
const SCAN = ['index.html', 'public', 'frontend'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage']);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|ico|heic|mp3|wav|ogg|m4a|mp4|webm|mov|woff2?|ttf|otf|eot|pdf|zip|gz|wasm)$/i;
// 這個檔案本身要寫出舊名稱才能比對
const SELF = 'brandName.test.js';
const OLD_NAMES = ['源·語', '源・語'];

function* walk(path) {
  if (statSync(path).isFile()) { yield path; return; }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(path, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (!BINARY_EXT.test(name) && name !== SELF) yield p;
  }
}

describe('品牌名稱統一為「原語」', () => {
  it('index.html、public、frontend 底下沒有舊寫法「源·語」「源・語」', () => {
    const offenders = [];
    for (const entry of SCAN) {
      const start = join(PROJECT, entry);
      if (!existsSync(start)) continue;
      for (const file of walk(start)) {
        const text = readFileSync(file, 'utf8');
        if (OLD_NAMES.some((old) => text.includes(old))) offenders.push(relative(PROJECT, file));
      }
    }
    expect(offenders, '請改成「原語」').toEqual([]);
  });

  it('PWA 安裝名稱與短名稱是「原語」', () => {
    const manifest = JSON.parse(readFileSync(join(PROJECT, 'public', 'manifest.webmanifest'), 'utf8'));
    expect(manifest.name.startsWith('原語')).toBe(true);
    expect(manifest.short_name).toBe('原語');
  });
});
