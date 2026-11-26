import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import {
    MemoryRouter, Route, Routes, useLocation, useNavigate,
} from 'react-router-dom';
import { confirmAction } from '@components/ui/ConfirmDialog';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import GrammarTree from './GrammarTree';
import {
    getGrammarSection,
    listNewWordRevisions,
    listGrammarSections,
    listTaxonomies,
    reorderGrammarSections,
} from './dictionaryApi';

let mockRole = 'editor';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({
        userData: { role: mockRole },
    }),
}));

vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: vi.fn(() => Promise.resolve(true)) }));

vi.mock('./dictionaryApi', () => ({
    getGrammarSection: vi.fn(),
    listNewWordRevisions: vi.fn(() => Promise.resolve({ results: [] })),
    listTaxonomies: vi.fn(),
    listGrammarSections: vi.fn(),
    reorderGrammarSections: vi.fn(),
}));

vi.mock('./GrammarNodePanel', () => ({
    default: ({ sectionId, onDirtyChange, focusOnLoad, onCreated }) => (
        <div data-testid="grammar-node-panel" data-focus-on-load={String(Boolean(focusOnLoad))}>
            {sectionId === null ? '新增面板' : `章節 ${sectionId}`}
            <button type="button" onClick={() => onDirtyChange?.(true)}>模擬編輯</button>
            <button type="button" onClick={() => onCreated?.(77)}>模擬第一次存檔</button>
        </div>
    ),
}));

const taxonomies = {
    tribes: [
        { id: 1, slug: 'tribe-one', name: '族語一' },
        { id: 2, slug: 'tribe-two', name: '族語二' },
    ],
    grammar_affix: [],
};

const tribeOneSections = {
    results: [
        {
            id: 10,
            tribe_id: 1,
            section_key: 'basic',
            title: '基礎句型',
            section_order: 1,
            rule_count: 2,
            pending_revision: { id: 90, status: 'pending_review', operation: 'update' },
        },
        {
            id: 20,
            tribe_id: 1,
            section_key: 'verb',
            title: '動詞',
            section_order: 2,
            rule_count: 3,
            pending_revision: null,
        },
    ],
};

function renderPage(path = '/admin/dictionary/grammar') {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <GrammarTree />
        </MemoryRouter>,
    );
}

describe('GrammarTree', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRole = 'editor';
        confirmAction.mockResolvedValue(true);

        listTaxonomies.mockResolvedValue(taxonomies);
        listGrammarSections.mockImplementation((tribeId) => (
            Promise.resolve(
                String(tribeId) === '2'
                    ? {
                        results: [{
                            id: 30, tribe_id: 2, title: '族語二章節', section_order: 1,
                            rule_count: 1, pending_revision: null,
                        }],
                    }
                    : tribeOneSections,
            )
        ));
        reorderGrammarSections.mockResolvedValue({ detail: 'ok' });
    });

    it('WP-8 追加：新建章節第一次存檔用 replace 換到提案網址，上一頁不會回到未存檔的新增畫面', async () => {
        function RevisionPage() {
            const navigate = useNavigate();
            const location = useLocation();
            return (
                <div>
                    <span>提案頁 {location.pathname} {location.state?.flash}</span>
                    <button type="button" onClick={() => navigate(-1)}>上一頁</button>
                </div>
            );
        }
        render(
            <MemoryRouter initialEntries={['/start', '/admin/dictionary/grammar']} initialIndex={1}>
                <Routes>
                    <Route path="/start" element={<div>起始頁</div>} />
                    <Route path="/admin/dictionary/grammar" element={<GrammarTree />} />
                    <Route path="/admin/dictionary/revisions/:id" element={<RevisionPage />} />
                </Routes>
            </MemoryRouter>,
        );

        await screen.findByText('基礎句型');
        fireEvent.click(screen.getByRole('button', { name: /新增章節/ }));
        fireEvent.click(await screen.findByRole('button', { name: '模擬第一次存檔' }));

        expect(await screen.findByText('提案頁 /admin/dictionary/revisions/77 草稿已儲存')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '上一頁' }));
        expect(await screen.findByText('起始頁')).toBeInTheDocument();
    });

    it('loads sections and renders revision badges', async () => {
        renderPage();

        expect(screen.getByText('載入文法章節中…')).toBeInTheDocument();

        expect(await screen.findByText('基礎句型')).toBeInTheDocument();
        expect(screen.getByText('規則 2 則')).toBeInTheDocument();
        expect(screen.getByText('送審中')).toBeInTheDocument();
        expect(listGrammarSections).toHaveBeenCalledWith('1');
    });

    it('switching tribes clears selection and reloads the list', async () => {
        renderPage();

        await screen.findByText('基礎句型');

        fireEvent.change(screen.getByLabelText(/^族語$/), { target: { value: '2' } });

        expect(await screen.findByText('族語二章節')).toBeInTheDocument();
        expect(listGrammarSections).toHaveBeenCalledWith('2');
        expect(screen.getByText('從左側選擇章節，或新增章節')).toBeInTheDocument();
    });

    it('回歸測試：舊族語較晚回來的章節清單，不會覆蓋掉已經切換過去的新族語清單', async () => {
        let resolveTribeOne;
        listGrammarSections.mockImplementation((tribeId) => {
            if (String(tribeId) === '1') {
                return new Promise((resolve) => { resolveTribeOne = resolve; });
            }
            return Promise.resolve({
                results: [{
                    id: 30, tribe_id: 2, title: '族語二章節', section_order: 1,
                    rule_count: 1, pending_revision: null,
                }],
            });
        });

        renderPage();
        await waitFor(() => expect(listGrammarSections).toHaveBeenCalledWith('1'));

        fireEvent.change(screen.getByLabelText(/^族語$/), { target: { value: '2' } });
        expect(await screen.findByText('族語二章節')).toBeInTheDocument();

        // 族語一（已經不是目前選取的族語）的查詢這時候才回來。
        await act(async () => {
            resolveTribeOne(tribeOneSections);
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByText('族語二章節')).toBeInTheDocument();
        expect(screen.queryByText('基礎句型')).not.toBeInTheDocument();
    });

    it('opens the new-section panel', async () => {
        renderPage();

        await screen.findByText('基礎句型');
        fireEvent.click(screen.getByRole('button', { name: /新增章節/ }));

        // 切換前會先檢查未儲存變更（非同步），所以要等面板出現
        expect(await screen.findByText('新增面板')).toBeInTheDocument();
    });

    it('reorders with the complete ordered section id array', async () => {
        listGrammarSections.mockResolvedValue({
            results: tribeOneSections.results.map((section) => ({ ...section, pending_revision: null })),
        });

        renderPage();
        await screen.findByText('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: '下移章節 基礎句型' }));

        await waitFor(() => {
            expect(reorderGrammarSections).toHaveBeenCalledWith('1', [20, 10]);
        });
    });

    it('disables all reorder buttons when any section has a revision', async () => {
        renderPage();
        await screen.findByText('基礎句型');

        expect(
            screen.getByText('有章節正在提案流程中，完成或捨棄提案後才能調整順序。'),
        ).toBeInTheDocument();

        expect(screen.getByRole('button', { name: '下移章節 基礎句型' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '上移章節 動詞' })).toBeDisabled();
    });

    it('hides add and reorder controls for a view-only role', async () => {
        mockRole = 'student';
        renderPage();

        await screen.findByText('基礎句型');

        expect(screen.queryByRole('button', { name: /新增章節/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /上移章節/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /下移章節/ })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /基礎句型/ }));
        expect(await screen.findByText('章節 10')).toBeInTheDocument();
    });

    it('稽核 FE7a-16：選取的章節標示 aria-current，並要求面板載入後取得焦點', async () => {
        renderPage();
        await screen.findByText('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /^基礎句型/ }));
        const panel = await screen.findByTestId('grammar-node-panel');

        expect(screen.getByRole('button', { name: /^基礎句型/ })).toHaveAttribute('aria-current', 'true');
        expect(screen.getByRole('button', { name: /^動詞/ })).not.toHaveAttribute('aria-current');
        expect(screen.getByRole('button', { name: /^基礎句型/ }).closest('.dictionary-nested-card')).toHaveClass('is-selected');
        expect(panel).toHaveAttribute('data-focus-on-load', 'true');
    });

    it('稽核 FE7a-04：面板有未儲存變更時，切換章節先確認；取消則留在原章節', async () => {
        renderPage();
        await screen.findByText('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /^基礎句型/ }));
        await screen.findByText('章節 10');
        fireEvent.click(screen.getByRole('button', { name: '模擬編輯' }));

        confirmAction.mockResolvedValueOnce(false);
        fireEvent.click(screen.getByRole('button', { name: /^動詞/ }));

        await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
        expect(screen.getByText('章節 10')).toBeInTheDocument();

        confirmAction.mockResolvedValueOnce(true);
        fireEvent.click(screen.getByRole('button', { name: /^動詞/ }));
        expect(await screen.findByText('章節 20')).toBeInTheDocument();
    });

    it('稽核 FE7a-04：面板有未儲存變更時，切換族語先確認；取消則不切換', async () => {
        renderPage();
        await screen.findByText('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /^基礎句型/ }));
        await screen.findByText('章節 10');
        fireEvent.click(screen.getByRole('button', { name: '模擬編輯' }));

        confirmAction.mockResolvedValueOnce(false);
        fireEvent.change(screen.getByLabelText(/^族語$/), { target: { value: '2' } });

        await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
        expect(listGrammarSections).not.toHaveBeenCalledWith('2');
        expect(screen.getByText('章節 10')).toBeInTheDocument();
    });

    it('沒有未儲存變更時切換章節不跳確認', async () => {
        renderPage();
        await screen.findByText('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /^基礎句型/ }));
        await screen.findByText('章節 10');
        fireEvent.click(screen.getByRole('button', { name: /^動詞/ }));

        expect(await screen.findByText('章節 20')).toBeInTheDocument();
        expect(confirmAction).not.toHaveBeenCalled();
    });

    it('稽核 FE7a-02：列出我的新建章節草稿與待審的新建章節', async () => {
        listNewWordRevisions.mockResolvedValue({
            results: [{ id: 55, status: 'draft', title: '新章節草稿', tribe: 'tribe-one' }],
        });
        renderPage();

        const link = await screen.findByRole('link', { name: '新章節草稿' });
        expect(link).toHaveAttribute('href', '/admin/dictionary/revisions/55');
        expect(listNewWordRevisions).toHaveBeenCalledWith('grammar_section');
    });

    it('稽核 FE7a-02：以 ?section= 開啟時切到該章節的族語並選取它', async () => {
        getGrammarSection.mockResolvedValue({ id: 30, tribe_id: 2, title: '族語二章節' });
        renderPage('/admin/dictionary/grammar?section=30');

        expect(await screen.findByText('章節 30')).toBeInTheDocument();
        expect(getGrammarSection).toHaveBeenCalledWith('30');
        expect(listGrammarSections).toHaveBeenCalledWith('2');
    });
});
