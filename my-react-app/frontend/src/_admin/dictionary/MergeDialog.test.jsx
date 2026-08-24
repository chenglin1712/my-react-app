import {
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';
import {
    act, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import MergeDialog from './MergeDialog';
import { mergeTaxonomyTerm } from './dictionaryApi';

vi.mock('./dictionaryApi', () => ({
    mergeTaxonomyTerm: vi.fn(),
}));

const source = { id: 1, name: '動物', reference_count: 3 };
const options = [
    { id: 2, name: '動物類' },
    { id: 3, name: '植物' },
];

const baseProps = {
    kind: 'category',
    kindLabel: '分類',
    isAffix: false,
    source,
    options,
    onClose: vi.fn(),
    onMerged: vi.fn(),
};

describe('MergeDialog', () => {
    beforeEach(() => {
        mergeTaxonomyTerm.mockReset();
        baseProps.onClose.mockReset();
        baseProps.onMerged.mockReset();
    });

    test('顯示標題、引用數與合併目標選項', () => {
        render(<MergeDialog {...baseProps} />);

        expect(screen.getByText('合併分類')).toBeInTheDocument();
        expect(screen.getByText(/3 處引用/)).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '動物類' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '植物' })).toBeInTheDocument();
    });

    test('沒有選目標或沒有輸入正確名稱時確認按鈕停用', () => {
        render(<MergeDialog {...baseProps} />);
        const confirmButton = screen.getByRole('button', { name: '確認合併' });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText(/合併目標/), { target: { value: '2' } });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText(/請輸入「動物」以確認合併/), {
            target: { value: '動物類' },
        });
        expect(confirmButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText(/請輸入「動物」以確認合併/), {
            target: { value: '動物' },
        });
        expect(confirmButton).toBeEnabled();
    });

    test('送出後呼叫 mergeTaxonomyTerm 並回報 onMerged', async () => {
        mergeTaxonomyTerm.mockResolvedValue({ target_id: 2, merged_references: 3 });
        render(<MergeDialog {...baseProps} />);

        fireEvent.change(screen.getByLabelText(/合併目標/), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText(/請輸入「動物」以確認合併/), {
            target: { value: '動物' },
        });
        fireEvent.click(screen.getByRole('button', { name: '確認合併' }));

        await waitFor(() => {
            expect(mergeTaxonomyTerm).toHaveBeenCalledWith('category', 1, 2);
        });
        expect(baseProps.onMerged).toHaveBeenCalledWith({ target_id: 2, merged_references: 3 });
    });

    test('合併失敗顯示錯誤訊息，不呼叫 onMerged', async () => {
        mergeTaxonomyTerm.mockRejectedValue(new Error('只能合併同族語的詞綴'));
        render(<MergeDialog {...baseProps} />);

        fireEvent.change(screen.getByLabelText(/合併目標/), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText(/請輸入「動物」以確認合併/), {
            target: { value: '動物' },
        });
        fireEvent.click(screen.getByRole('button', { name: '確認合併' }));

        expect(await screen.findByText('只能合併同族語的詞綴')).toBeInTheDocument();
        expect(baseProps.onMerged).not.toHaveBeenCalled();
    });

    test('取消呼叫 onClose', () => {
        render(<MergeDialog {...baseProps} />);
        fireEvent.click(screen.getByRole('button', { name: '取消' }));
        expect(baseProps.onClose).toHaveBeenCalled();
    });

    /** react-bootstrap 的 <Button> 在沒有指定 as/href 時，本來就會把
     * type 預設成 'button'（@restart/ui useButtonProps 裡的
     * `type: type || 'button'`），不是原生 HTML button 的 type="submit"
     * 預設值。這裡明確指定 type="button" 是跟其他檔案的既有慣例保持一致、
     * 避免日後改成別的元件時失去這層保護，而不是修一個目前真的能被觸發的
     * 錯誤送出——這則測試確認的是這個行為，不是回歸測試。 */
    test('已填好合併條件時點取消，不會誤送出合併', () => {
        render(<MergeDialog {...baseProps} />);

        fireEvent.change(screen.getByLabelText(/合併目標/), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText(/請輸入「動物」以確認合併/), {
            target: { value: '動物' },
        });
        expect(screen.getByRole('button', { name: '確認合併' })).toBeEnabled();

        fireEvent.click(screen.getByRole('button', { name: '取消' }));

        expect(baseProps.onClose).toHaveBeenCalled();
        expect(mergeTaxonomyTerm).not.toHaveBeenCalled();
    });

    test('同一個 tick 內雙擊確認按鈕，只送出一次合併請求', async () => {
        let resolveMerge;
        mergeTaxonomyTerm.mockImplementation(() => new Promise((resolve) => { resolveMerge = resolve; }));

        render(<MergeDialog {...baseProps} />);

        fireEvent.change(screen.getByLabelText(/合併目標/), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText(/請輸入「動物」以確認合併/), {
            target: { value: '動物' },
        });

        const confirmButton = screen.getByRole('button', { name: '確認合併' });
        act(() => {
            fireEvent.click(confirmButton);
            fireEvent.click(confirmButton);
        });

        expect(mergeTaxonomyTerm).toHaveBeenCalledTimes(1);

        resolveMerge({ target_id: 2, merged_references: 3 });
        await waitFor(() => {
            expect(baseProps.onMerged).toHaveBeenCalledTimes(1);
        });
    });

    test('詞綴模式下選項顯示 affix 欄位', () => {
        render(
            <MergeDialog
                {...baseProps}
                isAffix
                source={{
                    id: 5, tribe_id: 'tribe-tayal', affix: 'm-', reference_count: 2,
                }}
                options={[{ id: 6, tribe_id: 'tribe-tayal', affix: 'mu-' }]}
            />,
        );

        expect(screen.getByRole('option', { name: 'mu-' })).toBeInTheDocument();
        expect(screen.getByLabelText(/請輸入「m-」以確認合併/)).toBeInTheDocument();
    });
});
