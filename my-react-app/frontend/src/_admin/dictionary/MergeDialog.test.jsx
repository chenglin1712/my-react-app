import {
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor,
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
