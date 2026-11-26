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
    approveRevision,
    createGrammarSectionProposal,
    discardRevision,
    getGrammarSection,
    getRevision,
    proposeGrammarSectionDelete,
    proposeGrammarSectionUpdate,
    updateRevisionPayload,
} from './dictionaryApi';

// 站內確認視窗（原本是瀏覽器原生 window.confirm）：測試直接替換成可控制回傳值的 mock
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

let mockRole = 'editor';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole, uid: 'me' } }),
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
    isEditConflict: (err) => err?.status === 409 && err?.data?.code === 'edit_conflict',
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
        confirmMock.mockResolvedValue(true);

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
            updated_at: '2026-11-25T01:00:00+00:00',
            payload: { ...existingSection, title: '草稿章節' },
        });

        renderPanel({ sectionId: 10 });

        await screen.findByDisplayValue('草稿章節');
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        // 稽核 FE7a-06：草稿 PUT 帶載入時的 updated_at 做樂觀鎖
        await waitFor(() => {
            expect(updateRevisionPayload).toHaveBeenCalledWith(
                90,
                expect.objectContaining({ title: '草稿章節' }),
                { baseUpdatedAt: '2026-11-25T01:00:00+00:00' },
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

        expect(await screen.findByRole('alert')).toHaveTextContent('內容版本衝突。');
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
        confirmMock.mockResolvedValue(true);

        renderPanel({ sectionId: 10, onSaved });

        await screen.findByDisplayValue('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /建立刪除提案/ }));

        await waitFor(() => {
            expect(proposeGrammarSectionDelete).toHaveBeenCalledWith(10);
        });
        // 稽核 FE7a-17：這一步只是建立提案，文案不能寫「無法復原」
        expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: '建立刪除提案', confirmLabel: '建立刪除提案' }));
        const { message } = confirmMock.mock.calls[0][0];
        const { container } = render(message);
        expect(container).toHaveTextContent('送審核准後才會移除');
        expect(container).not.toHaveTextContent('無法復原');
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
        confirmMock.mockResolvedValue(true);
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

    it('稽核 FE7a-01：詳情回傳 open_revision（草稿）時載入草稿內容', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { pending_revision: null, open_revision: { id: 91, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 91, status: 'draft', operation: 'update', payload: { ...existingSection, title: '我的草稿' },
        });

        renderPanel({ sectionId: 10 });

        expect(await screen.findByDisplayValue('我的草稿')).toBeInTheDocument();
        expect(getRevision).toHaveBeenCalledWith(91);
    });

    it('稽核 FE7a-03：載入刪除提案時表單顯示目前內容並標示為刪除提案', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { pending_revision: { id: 92, status: 'pending_review', operation: 'delete' } },
        });
        getRevision.mockResolvedValue({
            id: 92, status: 'pending_review', operation: 'delete', payload: {},
        });

        renderPanel({ sectionId: 10 });

        expect(await screen.findByDisplayValue('基礎句型')).toBeInTheDocument();
        expect(screen.getByDisplayValue('規則一')).toBeInTheDocument();
        expect(screen.getByTestId('revision-delete-info')).toHaveTextContent('這是刪除提案');
    });

    it('稽核 FE7a-06：草稿 PUT 遇到 edit_conflict 時可載入最新內容，再改回自己的版本', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { pending_revision: { id: 90, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValueOnce({
            id: 90, status: 'draft', operation: 'update', updated_at: 't1', payload: existingSection,
        });
        const conflict = new Error('內容已被其他人更新');
        conflict.status = 409;
        conflict.data = { code: 'edit_conflict' };
        updateRevisionPayload.mockRejectedValueOnce(conflict);

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');

        fireEvent.change(screen.getByLabelText(/章節名稱/), { target: { value: '我的修改' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        expect(await screen.findByText(/這份草稿在你編輯期間已被修改/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '改回我的版本' })).not.toBeInTheDocument();

        getRevision.mockResolvedValueOnce({
            id: 90, status: 'draft', operation: 'update', updated_at: 't2',
            payload: { ...existingSection, title: '別人的修改' },
        });
        fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
        expect(await screen.findByDisplayValue('別人的修改')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '改回我的版本' }));
        expect(await screen.findByDisplayValue('我的修改')).toBeInTheDocument();

        updateRevisionPayload.mockResolvedValueOnce({ id: 90, updated_at: 't3' });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await waitFor(() => {
            expect(updateRevisionPayload).toHaveBeenLastCalledWith(
                90, expect.objectContaining({ title: '我的修改' }), { baseUpdatedAt: 't2' },
            );
        });
    });

    it('WP-8 追加：propose 撞到載入後才出現的他人草稿（409 附 revision_id）時，可載入那份草稿，之後改走 PUT 並帶樂觀鎖', async () => {
        mockRole = 'admin';
        const conflict = new Error('這個項目已經有一份其他人建立的草稿');
        conflict.status = 409;
        conflict.data = { code: 'edit_conflict', revision_id: 95 };
        proposeGrammarSectionUpdate.mockRejectedValueOnce(conflict);

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');
        fireEvent.change(screen.getByLabelText(/章節名稱/), { target: { value: '我的修改' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        expect(await screen.findByText(/這份草稿在你編輯期間已被修改/)).toBeInTheDocument();

        getRevision.mockResolvedValueOnce({
            id: 95, status: 'draft', operation: 'update', updated_at: 't95', created_by: 'alice',
            payload: { ...existingSection, title: '別人的修改' },
        });
        fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
        expect(await screen.findByDisplayValue('別人的修改')).toBeInTheDocument();
        expect(getRevision).toHaveBeenLastCalledWith(95);

        fireEvent.click(screen.getByRole('button', { name: '改回我的版本' }));
        await screen.findByDisplayValue('我的修改');
        updateRevisionPayload.mockResolvedValueOnce({ id: 95, updated_at: 't96' });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await waitFor(() => {
            expect(updateRevisionPayload).toHaveBeenLastCalledWith(
                95, expect.objectContaining({ title: '我的修改' }), { baseUpdatedAt: 't95' },
            );
        });
        expect(proposeGrammarSectionUpdate).toHaveBeenCalledTimes(1);
    });

    it('稽核 FE7a-09：捨棄草稿前要確認，取消則不呼叫 API', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { pending_revision: { id: 90, status: 'draft', operation: 'update' } },
        });
        confirmMock.mockResolvedValue(false);

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');

        fireEvent.click(screen.getByRole('button', { name: /捨棄草稿/ }));

        await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: '捨棄草稿' })));
        expect(discardRevision).not.toHaveBeenCalled();
    });

    it('稽核 BE1-03／FE7a-13：核准帶載入時的 updated_at，並列出與現行版本的差異', async () => {
        mockRole = 'reviewer';
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { pending_revision: { id: 93, status: 'pending_review', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 93,
            status: 'pending_review',
            operation: 'update',
            updated_at: '2026-11-25T02:00:00+00:00',
            payload: {
                ...existingSection,
                title: '改名後',
                rules: [
                    existingSection.rules[0],
                    {
                        id: null, rule_key: '', title: '新規則', structure: '', function: '', notes: '', affix_ids: [], examples: [],
                    },
                ],
            },
        });
        approveRevision.mockResolvedValue({ id: 93, status: 'approved' });

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('改名後');

        const summary = screen.getByRole('region', { name: '變更摘要' });
        expect(summary).toHaveTextContent('修改「章節名稱」');
        expect(summary).toHaveTextContent('新增規則 2「新規則」');
        expect(summary).not.toHaveTextContent('章節說明');

        fireEvent.click(screen.getByRole('button', { name: /核准/ }));
        await waitFor(() => {
            expect(approveRevision).toHaveBeenCalledWith(93, {
                reviewComment: '', baseUpdatedAt: '2026-11-25T02:00:00+00:00',
            });
        });
    });

    it('稽核 BE1-03：核准遇到 edit_conflict 時提示重新載入', async () => {
        mockRole = 'reviewer';
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { pending_revision: { id: 93, status: 'pending_review', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 93, status: 'pending_review', operation: 'update', updated_at: 't1', payload: existingSection,
        });
        const conflict = new Error('內容已被其他人更新');
        conflict.status = 409;
        conflict.data = { code: 'edit_conflict' };
        approveRevision.mockRejectedValue(conflict);

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');
        fireEvent.click(screen.getByRole('button', { name: /核准/ }));

        expect(await screen.findByText('內容在你審核期間被修改，請重新載入')).toBeInTheDocument();
    });

    it('稽核 FE7a-02：以 revisionId 開啟新建章節提案時從提案載入內容', async () => {
        getRevision.mockResolvedValue({
            id: 95, target_kind: 'grammar_section', target_id: '', status: 'draft', operation: 'create',
            updated_at: 't1', payload: { ...existingSection, id: undefined, title: '新章節提案' },
        });

        renderPanel({ sectionId: null, revisionId: 95 });

        expect(await screen.findByDisplayValue('新章節提案')).toBeInTheDocument();
        expect(getGrammarSection).not.toHaveBeenCalled();
        expect(screen.getByText(/這是新建文法章節的提案/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await waitFor(() => {
            expect(updateRevisionPayload).toHaveBeenCalledWith(95, expect.anything(), { baseUpdatedAt: 't1' });
        });
        expect(createGrammarSectionProposal).not.toHaveBeenCalled();
    });

    it('稽核 FE7a-04：有未儲存變更時回報 onDirtyChange(true)，存檔後回到 false', async () => {
        const onDirtyChange = vi.fn();
        renderPanel({ sectionId: 10, onDirtyChange });
        await screen.findByDisplayValue('基礎句型');
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);

        fireEvent.change(screen.getByLabelText(/章節名稱/), { target: { value: '改過' } });
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    });

    it('稽核 WP-8 驗證：別人建立的章節草稿為唯讀並顯示提示', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { open_revision: { id: 90, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 90, status: 'draft', operation: 'update', created_by: 'alice', payload: existingSection,
        });

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');

        expect(screen.getByText('這是 alice 建立的草稿，你無法修改。')).toBeInTheDocument();
        expect(screen.getByLabelText(/章節名稱/)).toBeDisabled();
        expect(screen.queryByRole('button', { name: /捨棄草稿/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^送審/ })).not.toBeInTheDocument();
    });

    it('WP-8 追加：別人的章節草稿提示顯示建立者姓名', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { open_revision: { id: 90, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 90, status: 'draft', operation: 'update', created_by: 'alice', created_by_name: '王小美',
            payload: existingSection,
        });

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');
        expect(screen.getByText('這是 王小美 建立的草稿，你無法修改。')).toBeInTheDocument();
    });

    it('WP-8 追加：別人送審中的章節提案，提示不說「可先撤回」，改說誰能撤回', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { open_revision: { id: 90, status: 'pending_review', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 90, status: 'pending_review', operation: 'update',
            created_by: 'alice', created_by_name: '王小美', submitted_by: 'alice', submitted_by_name: '王小美',
            payload: existingSection,
        });

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');
        expect(screen.queryByRole('button', { name: /撤回/ })).not.toBeInTheDocument();
        expect(screen.queryByText(/可以先撤回提案再修改/)).not.toBeInTheDocument();
        expect(screen.getByText(
            '此章節提案正在送審，欄位為唯讀；只有建立者 王小美或擁有者／管理員可以撤回後修改，請等待審核結果或聯繫他們。',
        )).toBeInTheDocument();
    });

    it('WP-8 追加：自己送審中的章節提案提示可以先撤回', async () => {
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { open_revision: { id: 90, status: 'pending_review', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 90, status: 'pending_review', operation: 'update', created_by: 'me', submitted_by: 'me',
            payload: existingSection,
        });

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');
        expect(screen.getByRole('button', { name: /撤回/ })).toBeInTheDocument();
        expect(screen.getByText('此章節提案正在送審，欄位為唯讀；可以先撤回提案再修改。')).toBeInTheDocument();
    });

    it('稽核 FE7a-05 殘留：後端的章節欄位錯誤顯示在欄位上，必填檢查也標在章節名稱', async () => {
        const error = new Error('請求參數錯誤');
        error.status = 400;
        error.data = { errors: { section_key: '不可超過 64 字', 'rules[0].title': '必須是字串' } };
        proposeGrammarSectionUpdate.mockRejectedValueOnce(error);

        renderPanel({ sectionId: 10 });
        await screen.findByDisplayValue('基礎句型');
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        const keyInput = screen.getByLabelText('章節代碼');
        await waitFor(() => expect(keyInput).toHaveClass('is-invalid'));
        expect(screen.getByText('不可超過 64 字', { selector: '.invalid-feedback' })).toBeInTheDocument();
        expect(screen.getByLabelText(/章節名稱/)).not.toHaveClass('is-invalid');
        fireEvent.change(keyInput, { target: { value: 'basic2' } });
        expect(keyInput).not.toHaveClass('is-invalid');

        const titleInput = screen.getByLabelText(/章節名稱/);
        fireEvent.change(titleInput, { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await waitFor(() => expect(titleInput).toHaveClass('is-invalid'));
    });

    it('稽核 WP-8 驗證：「改回我的版本」後仍回報有未儲存變更', async () => {
        const onDirtyChange = vi.fn();
        getGrammarSection.mockResolvedValue({
            ...existingSection,
            meta: { open_revision: { id: 90, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValueOnce({
            id: 90, status: 'draft', operation: 'update', updated_at: 't1', payload: existingSection,
        });
        const conflict = new Error('內容已被其他人更新');
        conflict.status = 409;
        conflict.data = { code: 'edit_conflict' };
        updateRevisionPayload.mockRejectedValueOnce(conflict);

        renderPanel({ sectionId: 10, onDirtyChange });
        await screen.findByDisplayValue('基礎句型');
        fireEvent.change(screen.getByLabelText(/章節名稱/), { target: { value: '我的修改' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await screen.findByText(/這份草稿在你編輯期間已被修改/);

        getRevision.mockResolvedValueOnce({
            id: 90, status: 'draft', operation: 'update', updated_at: 't2',
            payload: { ...existingSection, title: '別人的修改' },
        });
        fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
        await screen.findByDisplayValue('別人的修改');
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));

        fireEvent.click(screen.getByRole('button', { name: '改回我的版本' }));
        await screen.findByDisplayValue('我的修改');
        await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    });

    it('稽核 FE7a-02：新建章節第一次存檔後呼叫 onCreated（換到提案專屬網址）', async () => {
        const onCreated = vi.fn();
        renderPanel({ onCreated });
        await screen.findByText('新增文法章節');

        fireEvent.change(screen.getByLabelText(/章節名稱/), { target: { value: '新章節' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        await waitFor(() => expect(onCreated).toHaveBeenCalledWith(81));
    });

    it('以 initialRevision 開啟提案時不重複讀取', async () => {
        const initialRevision = {
            id: 95, target_kind: 'grammar_section', target_id: '', status: 'draft', operation: 'create',
            created_by: 'me', updated_at: 't1', payload: { ...existingSection, title: '已讀過的提案' },
        };
        renderPanel({ sectionId: null, revisionId: 95, initialRevision, flashMessage: '草稿已儲存' });

        expect(await screen.findByDisplayValue('已讀過的提案')).toBeInTheDocument();
        expect(getRevision).not.toHaveBeenCalled();
        expect(screen.getByText('草稿已儲存')).toBeInTheDocument();
    });

    it('稽核 FE7a-16：focusOnLoad 時載入完成後焦點移到面板標題', async () => {
        renderPanel({ sectionId: 10, focusOnLoad: true });
        const heading = await screen.findByRole('heading', { name: '文法章節詳情' });
        await waitFor(() => expect(heading).toHaveFocus());
    });
});
