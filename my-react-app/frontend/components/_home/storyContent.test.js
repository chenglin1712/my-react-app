import { describe, expect, test } from 'vitest';
import { STORY_KICKER, STORY_LIMITS, STORY_PATTERNS, STORY_STEPS, isValidStep, resolveStory } from './storyContent';

const step = (n, over = {}) => ({ glyph: `字${n}`, title: `標題${n}`, text: `說明${n}`, pattern: 'stripe', ...over });
const steps = (count) => Array.from({ length: count }, (_, i) => step(i + 1));

describe('預設內容', () => {
    test('四步、織紋四種各一次、全部通過自己的驗證，且落在上限內', () => {
        expect(STORY_STEPS).toHaveLength(4);
        expect(STORY_STEPS.map((s) => s.pattern)).toEqual(['stripe', 'vertical', 'dots', 'grid']);
        expect(STORY_PATTERNS.map((p) => p.value)).toEqual(['stripe', 'vertical', 'dots', 'grid']);
        STORY_STEPS.forEach((s) => expect(isValidStep(s), s.title).toBe(true));
        expect(STORY_KICKER.length).toBeLessThanOrEqual(STORY_LIMITS.kicker);
    });

    test('上限與後端 adminapi/validators.py 一致', () => {
        expect(STORY_LIMITS).toEqual({ minSteps: 3, maxSteps: 6, glyph: 4, title: 16, text: 80, kicker: 20 });
    });
});

describe('isValidStep', () => {
    test('邊界值通過，超過或空白或織紋不認得就不通過', () => {
        expect(isValidStep(step(1, { glyph: '一二三四', title: '標'.repeat(16), text: '說'.repeat(80) }))).toBe(true);
        expect(isValidStep(step(1, { glyph: '一二三四五' }))).toBe(false);
        expect(isValidStep(step(1, { title: '標'.repeat(17) }))).toBe(false);
        expect(isValidStep(step(1, { text: '說'.repeat(81) }))).toBe(false);
        expect(isValidStep(step(1, { title: '   ' }))).toBe(false);
        expect(isValidStep(step(1, { pattern: 'diagonal' }))).toBe(false);
        expect(isValidStep(step(1, { text: 5 }))).toBe(false);
        expect(isValidStep(null)).toBe(false);
    });
});

describe('resolveStory：後台設定 → 畫面內容，壞資料一律退回預設而不是壞掉', () => {
    const DEFAULTS = { enabled: true, kicker: STORY_KICKER, steps: STORY_STEPS };

    test('沒有 story、不是物件（舊版後端、設定抓不到）：用預設並啟用', () => {
        [undefined, null, 'x', 5].forEach((v) => expect(resolveStory(v)).toEqual(DEFAULTS));
    });

    test('後台關閉：enabled 為 false（首頁整段不輸出）', () => {
        expect(resolveStory({ enabled: false, kicker: '', steps: [] }).enabled).toBe(false);
    });

    test('後台沒填（steps 空清單）：用預設步驟，小標有填就用自己的', () => {
        expect(resolveStory({ enabled: true, kicker: '', steps: [] })).toEqual(DEFAULTS);
        expect(resolveStory({ enabled: true, kicker: ' 自訂小標 ', steps: [] })).toEqual({ ...DEFAULTS, kicker: '自訂小標' });
    });

    test('3 到 6 步都接受，並去掉前後空白', () => {
        [3, 4, 5, 6].forEach((n) => {
            const out = resolveStory({ enabled: true, kicker: '', steps: steps(n) });
            expect(out.steps).toHaveLength(n);
            expect(out.steps[0]).toEqual(step(1));
        });
        const padded = resolveStory({ enabled: true, kicker: '', steps: [step(1, { glyph: ' 遇見 ' }), step(2), step(3)] });
        expect(padded.steps[0].glyph).toBe('遇見');
    });

    test('步數不在 3 到 6、或任何一步壞掉：整組退回預設，不混用', () => {
        [steps(2), steps(7), [step(1), step(2), step(3, { pattern: 'x' })], [step(1), step(2), null], 'not-a-list'].forEach((bad) => {
            expect(resolveStory({ enabled: true, kicker: '', steps: bad }).steps).toBe(STORY_STEPS);
        });
    });
});
