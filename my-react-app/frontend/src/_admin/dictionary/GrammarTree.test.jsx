import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import GrammarTree from './GrammarTree';
import {
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

vi.mock('./dictionaryApi', () => ({
    listTaxonomies: vi.fn(),
    listGrammarSections: vi.fn(),
    reorderGrammarSections: vi.fn(),
}));

vi.mock('./GrammarNodePanel', () => ({
    default: ({ sectionId }) => (
        <div data-testid="grammar-node-panel">
            {sectionId === null ? '新增面板' : `章節 ${sectionId}`}
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

function renderPage() {
    return render(
        <MemoryRouter>
            <GrammarTree />
        </MemoryRouter>,
    );
}

describe('GrammarTree', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRole = 'editor';

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

        expect(screen.getByText('新增面板')).toBeInTheDocument();
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
        expect(screen.getByText('章節 10')).toBeInTheDocument();
    });
});
