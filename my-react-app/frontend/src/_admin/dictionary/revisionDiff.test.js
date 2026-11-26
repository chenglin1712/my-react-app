import { describe, expect, test } from 'vitest';
import { diffTrees, SECTION_DIFF_SPEC, WORD_DIFF_SPEC } from './revisionDiff';

const texts = (changes) => changes.map((change) => change.text);

describe('diffTrees（稽核 FE7a-13）', () => {
    test('相同內容沒有變更', () => {
        const word = { name: 'a', explanations: [{ id: 1, chinese_explanation: 'x' }] };
        expect(diffTrees(word, structuredClone(word), WORD_DIFF_SPEC)).toEqual([]);
    });

    test('列出修改欄位、新增、刪除與調整順序的子項', () => {
        const current = {
            name: 'a',
            pinyin: '',
            explanations: [
                { id: 1, chinese_explanation: '一' },
                { id: 2, chinese_explanation: '二' },
                { id: 3, chinese_explanation: '三' },
            ],
        };
        const proposed = {
            name: 'a',
            pinyin: 'p',
            explanations: [
                { id: 2, chinese_explanation: '二' },
                { id: 1, chinese_explanation: '一改' },
                { id: null, chinese_explanation: '新' },
            ],
        };
        expect(texts(diffTrees(current, proposed, WORD_DIFF_SPEC))).toEqual([
            '修改「拼音」',
            '解釋 2 › 修改「中文解釋」',
            '新增解釋 3',
            '刪除解釋 3',
            '調整解釋順序',
        ]);
    });

    test('巢狀子項的路徑與名稱', () => {
        const current = { title: 't', rules: [{ id: 9, title: '規則甲', examples: [{ id: 1, tribe_text: 'a', linked_words: [{ word_id: 'w1', word_name: '舊' }] }] }] };
        const proposed = { title: 't', rules: [{ id: 9, title: '規則甲', examples: [{ id: 1, tribe_text: 'a', linked_words: [{ word_id: 'w1', word_name: null }] }] }] };
        // 連結詞條只比 word_id，word_name 不同不算變更
        expect(diffTrees(current, proposed, SECTION_DIFF_SPEC)).toEqual([]);

        proposed.rules[0].examples[0].linked_words = [{ word_id: 'w2' }];
        expect(texts(diffTrees(current, proposed, SECTION_DIFF_SPEC))).toEqual([
            '規則 1「規則甲」 › 例句 1 › 修改「連結詞條」',
        ]);
    });
});
