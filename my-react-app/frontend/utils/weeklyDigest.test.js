import { describe, test, expect } from 'vitest';
import { cleanDigest, DIGEST_MAX_AGE_DAYS } from './weeklyDigest';

const NOW = Date.UTC(2026, 9, 22);
const DAY = 24 * 60 * 60 * 1000;
const stamp = (ms) => ({ toMillis: () => ms });
const base = (over = {}) => ({
  summary: '這週練習得很穩。', summarySource: 'model', dismissedAt: null, generatedAt: stamp(NOW - DAY),
  stats: { attempts: 3, questions: 10, correct: 7 }, reviewWords: [{ word: 'qutux', wrong: 2 }], ...over,
});

describe('cleanDigest', () => {
  test('正常的摘要整理成畫面用的資料', () => {
    expect(cleanDigest(base(), NOW)).toEqual({
      summary: '這週練習得很穩。', fromModel: true,
      stats: { attempts: 3, questions: 10, correct: 7 }, words: [{ word: 'qutux', wrong: 2 }],
    });
  });

  test('已關閉、過期、沒有摘要文字、不是物件都回 null', () => {
    expect(cleanDigest(base({ dismissedAt: stamp(NOW) }), NOW)).toBeNull();
    expect(cleanDigest(base({ generatedAt: stamp(NOW - (DIGEST_MAX_AGE_DAYS + 1) * DAY) }), NOW)).toBeNull();
    expect(cleanDigest(base({ summary: '  ' }), NOW)).toBeNull();
    expect(cleanDigest(null, NOW)).toBeNull();
    expect(cleanDigest('x', NOW)).toBeNull();
  });

  test('樣板摘要不標示為 AI；壞掉的複習詞與數字被清掉、詞最多 5 個', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ word: `w${i}`, wrong: i }));
    const cleaned = cleanDigest(base({
      summarySource: 'template', stats: { attempts: -1, questions: 'x', correct: 2.5 },
      reviewWords: [null, { word: '' }, { word: 5 }, ...many],
    }), NOW);
    expect(cleaned.fromModel).toBe(false);
    expect(cleaned.stats).toEqual({ attempts: 0, questions: 0, correct: 0 });
    expect(cleaned.words).toHaveLength(5);
  });
});
