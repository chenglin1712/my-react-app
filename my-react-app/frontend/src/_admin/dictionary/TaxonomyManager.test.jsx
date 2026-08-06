import {
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import TaxonomyManager from './TaxonomyManager';
import {
    createTaxonomyTerm, deleteTaxonomyTerm, listTaxonomies, updateTaxonomyTerm,
} from './dictionaryApi';

vi.mock('./dictionaryApi', () => ({
    listTaxonomies: vi.fn(),
    createTaxonomyTerm: vi.fn(),
    updateTaxonomyTerm: vi.fn(),
    deleteTaxonomyTerm: vi.fn(),
    mergeTaxonomyTerm: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({
        userData: { role: mockRole },
        loading: false,
    }),
}));

const baseTaxonomies = () => ({
    tribes: [
        { id: 'tribe-tayal', slug: 'tayal', name: '泰雅語' },
        { id: 'tribe-amis', slug: 'amis', name: '阿美語' },
    ],
    source: [
        { id: 1, name: '線上辭典', reference_count: 0 },
    ],
    category: [
        { id: 2, name: '動物', reference_count: 3 },
    ],
    part_of_speech: [
        { id: 3, name: '名詞', reference_count: 0 },
    ],
    focus: [
        { id: 4, name: '主事', reference_count: 0 },
    ],
    grammar_affix: [
        {
            id: 5, tribe_id: 'tribe-tayal', affix: 'm-', affix_type: 'prefix', function: '主事焦點', example_form: 'm-oyat',
        },
    ],
});

const renderPage = () => render(<TaxonomyManager />);

describe('TaxonomyManager', () => {
    beforeEach(() => {
        mockRole = 'owner';
        listTaxonomies.mockReset();
        createTaxonomyTerm.mockReset();
        updateTaxonomyTerm.mockReset();
        deleteTaxonomyTerm.mockReset();
        listTaxonomies.mockResolvedValue(baseTaxonomies());
        vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    test('預設顯示來源分頁，可切換到其他主檔', async () => {
        renderPage();

        expect(await screen.findByText('線上辭典')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '分類' }));
        expect(await screen.findByText('動物')).toBeInTheDocument();
        // reference_count 3 顯示成徽章文字
        expect(screen.getByText('3')).toBeInTheDocument();
    });

    test('詞綴分頁顯示族語名稱與類型中文標籤', async () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: '詞綴' }));

        const row = (await screen.findByText('m-')).closest('tr');
        expect(within(row).getByText('泰雅語')).toBeInTheDocument();
        expect(within(row).getByText('前綴')).toBeInTheDocument();
        expect(within(row).getByText('主事焦點')).toBeInTheDocument();
    });

    test('建立新的分類主檔', async () => {
        createTaxonomyTerm.mockResolvedValue({ id: 9, name: '植物', reference_count: 0 });
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: '分類' }));
        await screen.findByText('動物');

        fireEvent.change(screen.getByLabelText('新增分類'), { target: { value: '植物' } });
        fireEvent.click(screen.getByRole('button', { name: /^新增$/ }));

        await waitFor(() => {
            expect(createTaxonomyTerm).toHaveBeenCalledWith('category', { name: '植物' });
        });
    });

    test('建立新的詞綴會送出族語/詞綴/類型', async () => {
        createTaxonomyTerm.mockResolvedValue({
            id: 10, tribe_id: 'tribe-amis', affix: 'ma-', affix_type: 'prefix', function: '', example_form: '',
        });
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: '詞綴' }));
        await screen.findByText('m-');

        fireEvent.change(screen.getByLabelText('族語'), { target: { value: 'tribe-amis' } });
        fireEvent.change(screen.getByLabelText('詞綴'), { target: { value: 'ma-' } });
        fireEvent.click(screen.getByRole('button', { name: /新增詞綴/ }));

        await waitFor(() => {
            expect(createTaxonomyTerm).toHaveBeenCalledWith('grammar_affix', {
                tribe_id: 'tribe-amis', affix: 'ma-', affix_type: 'prefix', function: '', example_form: '',
            });
        });
    });

    test('編輯後儲存呼叫 updateTaxonomyTerm', async () => {
        updateTaxonomyTerm.mockResolvedValue({ id: 1, name: '線上辭典（新）', reference_count: 0 });
        renderPage();
        await screen.findByText('線上辭典');

        fireEvent.click(screen.getByRole('button', { name: /編輯/ }));
        const input = screen.getByDisplayValue('線上辭典');
        fireEvent.change(input, { target: { value: '線上辭典（新）' } });
        fireEvent.click(screen.getByRole('button', { name: '儲存' }));

        await waitFor(() => {
            expect(updateTaxonomyTerm).toHaveBeenCalledWith('source', 1, { name: '線上辭典（新）' });
        });
    });

    test('引用數為 0 才能刪除，刪除前需要 window.confirm', async () => {
        deleteTaxonomyTerm.mockResolvedValue({ detail: '已刪除' });
        renderPage();
        await screen.findByText('線上辭典');

        const row = screen.getByText('線上辭典').closest('tr');
        fireEvent.click(within(row).getByRole('button', { name: '刪除線上辭典' }));

        await waitFor(() => {
            expect(deleteTaxonomyTerm).toHaveBeenCalledWith('source', 1);
        });
        expect(window.confirm).toHaveBeenCalled();
    });

    test('有引用的項目刪除按鈕停用', async () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: '分類' }));
        await screen.findByText('動物');

        expect(screen.getByRole('button', { name: '刪除動物' })).toBeDisabled();
    });

    test('點擊合併開啟 MergeDialog', async () => {
        renderPage();
        fireEvent.click(screen.getByRole('button', { name: '分類' }));
        await screen.findByText('動物');

        fireEvent.click(screen.getByRole('button', { name: /合併/ }));

        expect(await screen.findByText('合併分類')).toBeInTheDocument();
    });

    test('editor 看不到合併按鈕，但看得到新增/編輯/刪除', async () => {
        mockRole = 'editor';
        renderPage();
        await screen.findByText('線上辭典');

        expect(screen.queryByRole('button', { name: /合併/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /編輯/ })).toBeInTheDocument();
        expect(screen.getByLabelText('新增來源')).toBeInTheDocument();
    });

    test('reviewer 看不到新增/編輯/刪除/合併', async () => {
        mockRole = 'reviewer';
        renderPage();
        await screen.findByText('線上辭典');

        expect(screen.queryByRole('button', { name: /編輯/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /合併/ })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('新增來源')).not.toBeInTheDocument();
    });

    test('載入失敗顯示錯誤訊息', async () => {
        listTaxonomies.mockReset();
        listTaxonomies.mockRejectedValue(new Error('主檔載入失敗'));
        renderPage();

        expect(await screen.findByText('主檔載入失敗')).toBeInTheDocument();
    });
});
