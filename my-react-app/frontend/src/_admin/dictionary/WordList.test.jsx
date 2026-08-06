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
import { MemoryRouter } from 'react-router-dom';
import WordList from './WordList';
import { listTaxonomies, listWords } from './dictionaryApi';

vi.mock('./dictionaryApi', () => ({
    listTaxonomies: vi.fn(),
    listWords: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({
        userData: { role: mockRole },
        loading: false,
    }),
}));

const taxonomies = {
    tribes: [
        {
            id: 'tribe-tayal',
            slug: 'tayal',
            name: '泰雅語',
        },
        {
            id: 'tribe-amis',
            slug: 'amis',
            name: '阿美語',
        },
    ],
    source: [],
    category: [],
    part_of_speech: [],
    focus: [],
};

const word = {
    id: 'word-1',
    tribe_id: 'tribe-tayal',
    name: 'abas',
    dialect: '',
    pinyin: '',
    frequency: 120,
    explanation_count: 2,
    sentence_count: 5,
    referenced_by_anaphora_items: 14,
    pending_revision: {
        id: 31,
        status: 'pending_review',
        operation: 'update',
        submitted_by: 'editor-uid',
        submitted_at: '2026-08-05T10:00:00Z',
    },
};

const renderPage = () => render(
    <MemoryRouter>
        <WordList />
    </MemoryRouter>,
);

describe('WordList', () => {
    beforeEach(() => {
        mockRole = 'owner';
        listTaxonomies.mockReset();
        listWords.mockReset();

        listTaxonomies.mockResolvedValue(taxonomies);
        listWords.mockResolvedValue({
            results: [word],
            count: 1,
            page: 1,
            page_size: 20,
        });
    });

    test('載入後顯示詞條、主檔名稱與統計欄位', async () => {
        renderPage();

        const name = await screen.findByText('abas');
        const row = name.closest('tr');

        expect(within(row).getByText('泰雅語')).toBeInTheDocument();
        expect(within(row).getByText('2')).toBeInTheDocument();
        expect(within(row).getByText('5')).toBeInTheDocument();
        expect(within(row).getByText('14')).toBeInTheDocument();
        expect(within(row).getByText('送審中')).toBeInTheDocument();
    });

    test('送出族語、詞形前綴與待審篩選參數', async () => {
        renderPage();
        await screen.findByText('abas');

        fireEvent.change(screen.getByLabelText('族語'), {
            target: { value: 'tribe-amis' },
        });
        fireEvent.change(screen.getByLabelText('關鍵字'), {
            target: { value: '  mal  ' },
        });
        fireEvent.click(screen.getByLabelText('只顯示有待審提案'));
        fireEvent.click(screen.getByRole('button', { name: /搜尋/ }));

        await waitFor(() => {
            expect(listWords).toHaveBeenLastCalledWith({
                tribe_id: 'tribe-amis',
                keyword: 'mal',
                has_pending: true,
                page: 1,
                page_size: 20,
            });
        });
    });

    test('沒有勾選待審篩選時不傳 has_pending', async () => {
        renderPage();

        await waitFor(() => {
            expect(listWords).toHaveBeenCalledWith({
                tribe_id: '',
                keyword: '',
                page: 1,
                page_size: 20,
            });
        });
    });

    test('詳情與新增詞條使用正確路由', async () => {
        renderPage();

        // Button as={Link}（react-bootstrap）渲染成 role="button" 而不是
        // "link"（底層 useButtonProps 沒收到明確的 role 時預設覆寫成
        // 'button'），這個專案其他頁面都是用這個查詢方式，這裡保持一致。
        const detailLink = await screen.findByRole('button', {
            name: /詳情/,
        });
        const createLink = screen.getByRole('button', {
            name: /新增詞條/,
        });

        expect(detailLink).toHaveAttribute(
            'href',
            '/admin/dictionary/words/word-1',
        );
        expect(createLink).toHaveAttribute(
            'href',
            '/admin/dictionary/words/new',
        );
    });

    test('沒有內容編輯權限時不顯示新增詞條按鈕', async () => {
        mockRole = 'reviewer';
        renderPage();

        await screen.findByText('abas');

        expect(screen.queryByRole('button', {
            name: /新增詞條/,
        })).not.toBeInTheDocument();

        expect(screen.getByRole('button', {
            name: /詳情/,
        })).toBeInTheDocument();
    });

    test('下一頁會重新載入伺服器分頁資料', async () => {
        listWords
            .mockResolvedValueOnce({
                results: [word],
                count: 25,
                page: 1,
                page_size: 20,
            })
            .mockResolvedValueOnce({
                results: [{
                    ...word,
                    id: 'word-2',
                    name: 'maku',
                    pending_revision: null,
                }],
                count: 25,
                page: 2,
                page_size: 20,
            });

        renderPage();
        await screen.findByText('abas');

        fireEvent.click(screen.getByRole('button', {
            name: '下一頁',
        }));

        expect(await screen.findByText('maku')).toBeInTheDocument();

        await waitFor(() => {
            expect(listWords).toHaveBeenLastCalledWith({
                tribe_id: '',
                keyword: '',
                page: 2,
                page_size: 20,
            });
        });
    });

    test('空結果顯示空狀態', async () => {
        listWords.mockResolvedValue({
            results: [],
            count: 0,
            page: 1,
            page_size: 20,
        });

        renderPage();

        expect(
            await screen.findByText('沒有符合條件的詞條'),
        ).toBeInTheDocument();
        expect(screen.getByText('共 0 筆')).toBeInTheDocument();
    });

    test('API 錯誤顯示 err.message', async () => {
        listWords.mockRejectedValue(new Error('詞條載入失敗'));

        renderPage();

        expect(
            await screen.findByText('詞條載入失敗'),
        ).toBeInTheDocument();
    });
});
