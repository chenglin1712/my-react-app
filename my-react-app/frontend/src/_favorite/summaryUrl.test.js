import { describe, expect, test } from 'vitest';
import { DEFAULT_FAVORITES_SUMMARY_URL, resolveFavoritesSummaryUrl } from './summaryUrl';

describe('resolveFavoritesSummaryUrl（部署機漏設環境變數時不能打到 /undefined）', () => {
  test.each([undefined, null, '', '   '])('沒設定（%j）→ 用預設路徑', (value) => {
    expect(resolveFavoritesSummaryUrl(value)).toBe(DEFAULT_FAVORITES_SUMMARY_URL);
  });

  test('有設定就照用（前後空白去掉）', () => {
    expect(resolveFavoritesSummaryUrl(' /custom/summary/ ')).toBe('/custom/summary/');
  });

  test('預設路徑與 .env.example 一致', () => {
    expect(DEFAULT_FAVORITES_SUMMARY_URL).toBe('/api/v1/dictionary/favorites-summary/');
  });
});
