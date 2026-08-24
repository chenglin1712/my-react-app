import {
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
import GrammarNodePanel from './GrammarNodePanel';
import {
    createGrammarSectionProposal,
    discardRevision,
    getGrammarSection,
    getRevision,
    proposeGrammarSectionDelete,
    proposeGrammarSectionUpdate,
    updateRevisionPayload,
} from './dictionaryApi';

let mockRole = 'editor';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole } }),
}));

vi.mock('./dictionaryApi', () => ({
    createGrammarSectionProposal: vi.fn(),
    getGrammarSection: vi.fn(),
    getRevision: vi.fn(),
    proposeGrammarSectionDelete: vi.fn(),
    proposeGrammarSectionUpdate: vi.fn(),
    updateRevisionPayload: vi.fn(),
    submitRevision: vi.fn(),
    withdrawRevision: vi.fn(),
    approveRevision: vi.fn(),
    rejectRevision: vi.fn(),
    discardRevision: vi.fn(),
}));

vi.mock('./WordPicker', () => ({
    default: ({
        label, wordId, wordName, disabled, onSelect,
    }) => (
        <div>
            <span>{label}</span>
            <span>{wordId ? `${wordId}:${wordName}` : '未連結'}</span>
            {!disabled && (
                <button
                    type="button"
                    onClick={() => onSelect({ word_id: 'word-new', word_name: '新詞' })}
                >
                    選取 {label}
                </button>
            )}
        </div>
    ),
}));

const taxonomies = {
    grammar_affix: [
        { id: 1, tribe_id: 1, affix: 'ma-' },
        { id: 2, tribe_id: 2, affix: 'ka-' },
    ],
};

const existingSection = {
    id: 10,
    tribe_id: 1,
    section_key: 'basic',
    title: '基礎句型',
    description: '說明',
    content_hash: 'sha256:old',
    meta: { section_order: 1, pending_revision: null },
    rules: [{
        id: 100,
        rule_key: 'rule-one',
        title: '規則一',
        structure: 'V + N',
        function: '敘述',
        notes: '',
        affix_ids: [1],
        examples: [{
            id: 1000,
            tribe_text: '族語句',
            chinese_text: '中文句',
            analysis: '分析',
            linked_words: [{ word_id: 'word-old', word_name: '舊詞' }],
        }],
    }],
};

function renderPanel(props = {}) {
    return render(
        <MemoryRouter>
            <GrammarNodePanel
                tribeId="1"
                sectionId={null}
                taxonomies={taxonomies}
                onSaved={vi.fn()}
                {...props}
            />
        </MemoryRouter>,
    );
}

describe('GrammarNodePanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRole = 'editor';

        getGrammarSection.mockResolvedValue(existingSection);
        createGrammarSectionProposal.mockResolvedValue({ revision_id: 81 });
        proposeGrammarSectionUpdate.mockResolvedValue({ revision_id: 82 });
        updateRevisionPayload.mockResolvedValue({ id: 83, status: 'draft' });
        proposeGrammarSectionDelete.mockResolvedValue({ revision_id: 84 });
        getRevision.mockResolvedValue({
            id: 90, status: 'draft', operation: 'update', payload: existingSection,
        });
    });

    it('creates a new section with the expected payload', async () => {
        const onSaved = vi.fn();
        renderPanel({ onSaved });

        await screen.findByText('新增文法章節');

        fireEvent.change(screen.getByLabelText(/章節代碼/), { target: { value: 'new-section' } });
        fireEvent.change(screen.getByLabelText(/章節名稱/), { target: { value: ' 新章節 ' } });
        fireEvent.change(screen.getByLabelText(/章節說明/), { target: { value: '新說明' } });

        fireEvent.click(screen.getByRole('button', { name: /新增規則/ }));
        fireEvent.change(screen.getByLabelText('規則名稱'), { target: { value: '第一條' } });
        fireEvent.click(screen.getByLabelText('ma-'));

        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        await waitFor(() => {
            expect(createGrammarSectionProposal).toHaveBeenCalledWith({
                tribe_id: '1',
                section_key: 'new-section',
                title: '新章節',
                description: '新說明',
                rules: [{
                    id: null,
                    rule_key: '',
                    title: '第一條',
                    structure: '',
                    function: '',
                    notes: '',
                    affix_ids: [1],
                    examples: [],
                }],
            });
        });
        expect(onSaved).toHaveBeenCalled();
    });

    it('preserves nested ids and sends base_hash on existing-section save', async () => {
        renderPanel({ sectionId: 10 });

        await screen.findByDisplayValue('基礎句型');

        fireEvent.change(screen.getByLabelText('規則名稱'), { target: { value: '更新後規則' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        await waitFor(() => {
            expect(proposeGrammarSectionUpdate).toHaveBeenCalled();
        });

        const [sectionId, payload] = proposeGrammarSectionUpdate.mock.calls[0];

        expect(sectionId).toBe(10);
        expect(payload.base_hash).toBe('sha256:old');
        expect(payload.id).toBe(10);
        expect(payload.rules[0].id).toBe(100);
        expect(payload.rules[0].examples[0].id).toBe(1000);
        expect(payload.rules[0].title).toBe('更新後規則');
        expect(payload.rules[0].examples[0].linked_words).toEqual([{
            word_id: 'word-old', word_name: '舊詞',
        }]);
    });

    it('only shows affixes belonging to the selected tribe', async () => {
        renderPanel({ sectionId: 10 });

        await screen.findByDisplayValue('基礎句型');

        expect(screen.getByLabelText('ma-')).toBeInTheDocument();
        expect(screen.queryByLabelText('ka-')).not.toBeInTheDocument();
    });

    it('adds, selects, and removes a linked word at the correct path', async () => {
        renderPanel({ sectionId: 10 });

        await screen.findByDisplayValue('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /新增連結/ }));
        fireEvent.click(screen.getByRole('button', { name: '選取 連結詞條 2' }));
        fireEvent.click(screen.getByRole('button', { name: '移除連結詞條 1' }));
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        await waitFor(() => {
            expect(proposeGrammarSectionUpdate).toHaveBeenCalled();
        });

        const payload = proposeGrammarSectionUpdate.mock.calls[0][1];

        expect(payload.rules[0].examples[0].linked_words).toEqual([{
            word_id: 'word-new', word_name: '新詞',
        }]);
    });

    it('loads pending revision payload and updates that draft', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { pending_revision: { id: 90, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 90,
            status: 'draft',
            operation: 'update',
            payload: { ...existingSection, title: '草稿章節' },
        });

        renderPanel({ sectionId: 10 });

        await screen.findByDisplayValue('草稿章節');
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        await waitFor(() => {
            expect(updateRevisionPayload).toHaveBeenCalledWith(
                90,
                expect.objectContaining({ title: '草稿章節' }),
            );
        });
        expect(proposeGrammarSectionUpdate).not.toHaveBeenCalled();
    });

    it('shows a specific optimistic-concurrency error for 409', async () => {
        const conflict = new Error('內容版本衝突。');
        conflict.status = 409;
        proposeGrammarSectionUpdate.mockRejectedValue(conflict);

        renderPanel({ sectionId: 10 });

        await screen.findByDisplayValue('基礎句型');
        fireEvent.change(screen.getByLabelText(/章節名稱/), { target: { value: '衝突內容' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent('文法章節在編輯期間已被其他人修改');
        expect(screen.getByRole('alert')).toHaveTextContent('請重新載入最新內容後再建立提案');
    });

    it('gates all editing and deletion controls for a view-only role', async () => {
        mockRole = 'student';

        renderPanel({ sectionId: 10 });

        await screen.findByDisplayValue('基礎句型');

        expect(screen.getByText('目前角色沒有文法章節編輯權限。')).toBeInTheDocument();
        expect(screen.getByLabelText(/章節名稱/)).toBeDisabled();
        expect(screen.queryByRole('button', { name: /儲存草稿/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /新增規則/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /建立刪除提案/ })).not.toBeInTheDocument();
    });

    it('creates a delete proposal after confirmation and keeps selection', async () => {
        const onSaved = vi.fn();
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        renderPanel({ sectionId: 10, onSaved });

        await screen.findByDisplayValue('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /建立刪除提案/ }));

        await waitFor(() => {
            expect(proposeGrammarSectionDelete).toHaveBeenCalledWith(10);
        });
        expect(window.confirm).toHaveBeenCalledWith('確定要刪除這個文法章節嗎？此操作無法復原。');
        expect(onSaved).toHaveBeenCalled();
        expect(await screen.findByText('刪除提案草稿已建立')).toBeInTheDocument();
    });

    /** 回歸測試：discard 成功後後端只回 { detail: '已捨棄' }，
     * handleRevisionChanged 原本一律用 revisionFromSave(result, current)
     * 合併，把舊 revision 的欄位整個從 current 補回來——後端已經刪掉這筆
     * revision，畫面卻繼續顯示它存在。 */
    it('捨棄既有章節的草稿後，重新載入正式內容，不殘留舊草稿', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { pending_revision: { id: 90, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 90,
            status: 'draft',
            operation: 'update',
            payload: { ...existingSection, title: '草稿中的章節' },
        });
        discardRevision.mockResolvedValue({ detail: '已捨棄' });

        renderPanel({ sectionId: 10 });
        expect(await screen.findByDisplayValue('草稿中的章節')).toBeInTheDocument();

        getGrammarSection.mockResolvedValue(existingSection);

        fireEvent.click(screen.getByRole('button', { name: /捨棄草稿/ }));

        await waitFor(() => {
            expect(discardRevision).toHaveBeenCalledWith(90);
        });

        expect(await screen.findByDisplayValue('基礎句型')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('草稿中的章節')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /捨棄草稿/ })).not.toBeInTheDocument();
    });

    /** 回歸測試：editable 原本沒有排除 operation === 'delete'，建立刪除
     * 提案後整份表單仍然可以編輯，「儲存草稿」還會把一般內容 payload 寫進
     * 這筆刪除提案裡。 */
    it('建立刪除提案後表單變成唯讀，不再顯示儲存草稿', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        proposeGrammarSectionDelete.mockResolvedValue({
            revision_id: 84, status: 'draft', operation: 'delete',
        });

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /建立刪除提案/ }));

        await waitFor(() => {
            expect(proposeGrammarSectionDelete).toHaveBeenCalledWith(10);
        });

        expect(await screen.findByText(/已建立刪除提案，內容為唯讀/)).toBeInTheDocument();
        expect(screen.getByLabelText(/章節名稱/)).toBeDisabled();
        expect(screen.queryByRole('button', { name: /儲存草稿/ })).not.toBeInTheDocument();
    });
});
