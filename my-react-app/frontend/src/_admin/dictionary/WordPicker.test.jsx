import { useState } from 'react';
import { describe, test, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import WordPicker from './WordPicker';
import { listWords } from './dictionaryApi';

vi.mock('./dictionaryApi', () => ({
    listWords: vi.fn(),
}));

describe('WordPicker', () => {
    /** 回歸測試：候選項目原本只有 onMouseDown、沒有 onClick，鍵盤使用者
     * Tab 到候選項目後按 Enter/Space 觸發的是合成 click 事件，完全選不到
     * 詞條。 */
    test('鍵盤啟用候選項目（Enter/Space 觸發的 click）可以選取詞條', async () => {
        const user = userEvent.setup();
        listWords.mockResolvedValue({
            results: [{ id: 'word-1', name: 'lokah', dialect: '', pinyin: '' }],
        });

        const onSelect = vi.fn();
        render(<WordPicker tribeId="tribe-1" onSelect={onSelect} />);

        await user.type(screen.getByLabelText('連結詞條'), 'lo');

        const option = await screen.findByRole('option', { name: /lokah/ });
        option.focus();
        await user.keyboard('{Enter}');

        expect(onSelect).toHaveBeenCalledWith({ word_id: 'word-1', word_name: 'lokah' });
    });

    test('滑鼠點擊候選項目只選取一次，不會因為 mousedown 又觸發一次', async () => {
        const user = userEvent.setup();
        listWords.mockResolvedValue({
            results: [{ id: 'word-1', name: 'lokah', dialect: '', pinyin: '' }],
        });

        const onSelect = vi.fn();
        render(<WordPicker tribeId="tribe-1" onSelect={onSelect} />);

        await user.type(screen.getByLabelText('連結詞條'), 'lo');
        const option = await screen.findByRole('option', { name: /lokah/ });
        await user.click(option);

        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    /** 回歸測試：已選詞條後修改查詢文字時，[wordId, wordName] 的同步
     * effect 會把使用者剛打的字清空——changeQuery() 因為清除選取而呼叫
     * onSelect({word_id: null, ...})，上層重新渲染後 wordId/wordName 變成
     * null，觸發那個「外部改變選取時同步 query」的 effect，把剛打的字
     * 蓋掉，使用者得打第二次才能搜尋替代詞。 */
    test('修改已選詞條的查詢文字時，第一次輸入不會被清空', async () => {
        listWords.mockResolvedValue({ results: [] });
        const onSelect = vi.fn();

        function Wrapper() {
            const [selection, setSelection] = useState({
                word_id: 'word-old', word_name: '舊詞',
            });

            return (
                <WordPicker
                    tribeId="tribe-1"
                    wordId={selection.word_id}
                    wordName={selection.word_name}
                    onSelect={(next) => {
                        onSelect(next);
                        setSelection(next);
                    }}
                />
            );
        }

        const user = userEvent.setup();
        render(<Wrapper />);

        const input = screen.getByLabelText('連結詞條');
        expect(input).toHaveValue('舊詞');

        await user.type(input, 'x');

        expect(onSelect).toHaveBeenCalledWith({ word_id: null, word_name: null });
        await waitFor(() => expect(input).toHaveValue('舊詞x'));
    });
});
