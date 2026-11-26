// frontend/src/_admin/dictionary/WordEditor.test.jsx
import {
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import {
    MemoryRouter,
    Route,
    RouterProvider,
    Routes,
    createMemoryRouter,
} from 'react-router-dom';
import WordEditor from './WordEditor';
import DictionaryRevisionRoute from './DictionaryRevisionRoute';
import { confirmAction } from '@components/ui/ConfirmDialog';
import {
    approveRevision,
    createWordProposal,
    discardRevision,
    getRevision,
    getWord,
    getWordReferences,
    listTaxonomies,
    listWords,
    proposeWordDelete,
    proposeWordUpdate,
    rejectRevision,
    submitRevision,
    updateRevisionPayload,
    withdrawRevision,
} from './dictionaryApi';

vi.mock('./dictionaryApi', () => ({
    approveRevision: vi.fn(),
    createWordProposal: vi.fn(),
    discardRevision: vi.fn(),
    getRevision: vi.fn(),
    getWord: vi.fn(),
    getWordReferences: vi.fn(),
    listTaxonomies: vi.fn(),
    listWords: vi.fn(),
    proposeWordDelete: vi.fn(),
    proposeWordUpdate: vi.fn(),
    rejectRevision: vi.fn(),
    submitRevision: vi.fn(),
    updateRevisionPayload: vi.fn(),
    withdrawRevision: vi.fn(),
    isEditConflict: (err) => err?.status === 409 && err?.data?.code === 'edit_conflict',
}));

// 稽核 FE7a-09：捨棄草稿改經 confirmAction；測試裡換成可控制的 mock（預設按確認）
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: vi.fn(() => Promise.resolve(true)) }));

vi.mock('./MediaUploadField', async () => {
    // 用真的 useReportUploading：值填 '__uploading__' 時模擬「上傳中」（稽核 FE7a-08）
    const { useReportUploading } = await import('./mediaUploadTracker');
    function MockMediaUploadField({
        kind,
        label,
        value,
        onChange,
        disabled,
    }) {
        useReportUploading(value === '__uploading__');
        return (
        <label>
            {label}
            <input
                aria-label={label}
                data-kind={kind}
                disabled={disabled}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </label>
        );
    }
    return { default: MockMediaUploadField };
});

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({
        userData: { role: mockRole, uid: 'me' },
        loading: false,
    }),
}));

const taxonomies = {
    tribes: [{
        id: 'tribe-tayal',
        slug: 'tayal',
        name: '泰雅語',
    }],
    source: [{
        id: 1,
        name: '線上辭典',
    }],
    category: [{
        id: 7,
        name: '動物',
    }],
    part_of_speech: [{
        id: 2,
        name: '名詞',
    }],
    focus: [{
        id: 1,
        name: '主事',
    }],
};

const effectiveWord = {
    id: 'word-1',
    tribe_id: 'tribe-tayal',
    dialect: '',
    name: 'abas',
    pinyin: '',
    variant: '',
    formation_word: '',
    derivative_root: '',
    frequency: 120,
    hit: 0,
    dictionary_note: '',
    word_img: '',
    is_derivative_root: false,
    is_image: false,
    is_zuzucidian: false,
    is_other_dialect: false,
    source_ids: [1],
    audios: [],
    explanations: [],
    content_hash: 'sha256:original',
    meta: {
        referenced_by_anaphora_items: 0,
        referenced_by_grammar_examples: 0,
        pending_revision: null,
    },
};

const renderEditor = (path = '/admin/dictionary/words/new', state = undefined) => render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <Routes>
            <Route
                path="/admin/dictionary/words/new"
                element={<WordEditor />}
            />
            <Route
                path="/admin/dictionary/words/:id"
                element={<WordEditor />}
            />
            <Route
                path="/admin/dictionary/words"
                element={<div>詞條列表</div>}
            />
            <Route
                path="/admin/dictionary/revisions/:id"
                element={<DictionaryRevisionRoute />}
            />
        </Routes>
    </MemoryRouter>,
);

// 站內換頁的未儲存攔截（useBlocker）只在 data router 底下運作；正式入口也是 data router，
// 結構同 appRoutes.jsx：只有一條 path: '*'，真正的路由在巢狀 <Routes>。
const renderEditorInDataRouter = (path) => {
    const router = createMemoryRouter([{
        path: '*',
        element: (
            <Routes>
                <Route path="/admin/dictionary/words/new" element={<WordEditor />} />
                <Route path="/admin/dictionary/words/:id" element={<WordEditor />} />
                <Route path="/admin/dictionary/words" element={<div>詞條列表</div>} />
                <Route path="/admin/dictionary/revisions/:id" element={<DictionaryRevisionRoute />} />
            </Routes>
        ),
    }], { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return router;
};

/** 新建草稿第一次存檔後會換到 /admin/dictionary/revisions/:id 並重新掛載編輯器（稽核 FE7a-02），
 * 等新頁面載入完成。提案路由讀到的提案直接交給編輯器，所以只讀一次。 */
async function waitForRevisionPage(revisionId) {
    await waitFor(() => {
        expect(getRevision.mock.calls.filter(([id]) => String(id) === String(revisionId)).length)
            .toBeGreaterThanOrEqual(1);
    });
    await screen.findByLabelText(/拼音/);
    expect(getRevision.mock.calls.filter(([id]) => String(id) === String(revisionId))).toHaveLength(1);
}

describe('WordEditor', () => {
    beforeEach(() => {
        mockRole = 'owner';

        [
            approveRevision,
            createWordProposal,
            discardRevision,
            getRevision,
            getWord,
            getWordReferences,
            listTaxonomies,
            listWords,
            proposeWordDelete,
            proposeWordUpdate,
            rejectRevision,
            submitRevision,
            updateRevisionPayload,
            withdrawRevision,
        ].forEach((mock) => mock.mockReset());

        confirmAction.mockReset();
        confirmAction.mockResolvedValue(true);
        listTaxonomies.mockResolvedValue(taxonomies);
        getWord.mockResolvedValue(effectiveWord);
        // 新建草稿第一次存檔後會導到 /admin/dictionary/revisions/:id，由 getRevision 載入
        getRevision.mockImplementation(async (revisionId) => ({
            id: Number(revisionId),
            target_kind: 'word',
            target_id: '',
            status: 'draft',
            operation: 'create',
            updated_at: 'rev-updated-1',
            payload: createWordProposal.mock.calls.at(-1)?.[0] ?? {},
        }));
        getWordReferences.mockResolvedValue({
            counts: {
                anaphora_items: 0,
                grammar_example_words: 0,
            },
            sample: [],
        });
    });

    test('新建詞條儲存時建立 create 草稿提案', async () => {
        createWordProposal.mockResolvedValue({
            revision_id: 42,
            status: 'draft',
        });

        renderEditor();

        await screen.findByText('尚未儲存');

        // /族語/ 沒有錨定會同時比對到「族語」下拉選單跟「族語辭典詞條」
        // 這個布林勾選框的 label（is_zuzucidian），兩者都包含「族語」子字串
        // ——錨定開頭＋後面接空白，只有下拉選單的「族語 *」符合。
        fireEvent.change(screen.getByLabelText(/^族語\s/), {
            target: { value: 'tribe-tayal' },
        });
        fireEvent.change(screen.getByLabelText(/詞形/), {
            target: { value: '  lokah  ' },
        });
        fireEvent.click(screen.getByLabelText('線上辭典'));
        fireEvent.click(screen.getByRole('button', {
            name: /儲存草稿/,
        }));

        await waitFor(() => {
            expect(createWordProposal).toHaveBeenCalledWith(
                expect.objectContaining({
                    tribe_id: 'tribe-tayal',
                    name: 'lokah',
                    source_ids: [1],
                    audios: [],
                    explanations: [],
                }),
            );
        });

        await waitForRevisionPage(42);
        expect(screen.getByText('草稿已儲存')).toBeInTheDocument();
        expect(screen.getByText('草稿')).toBeInTheDocument();
        expect(screen.getByDisplayValue('lokah')).toBeInTheDocument();
        expect(screen.getByRole('button', {
            name: '送審',
        })).toBeInTheDocument();
    });

    test('WP-8 追加：新建詞條第一次存檔用 replace 換到提案網址（與新建章節一致）', async () => {
        createWordProposal.mockResolvedValue({ revision_id: 43, status: 'draft' });
        const router = renderEditorInDataRouter('/admin/dictionary/words/new');

        await screen.findByText('尚未儲存');
        fireEvent.change(screen.getByLabelText(/^族語\s/), { target: { value: 'tribe-tayal' } });
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: 'lokah' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        await waitForRevisionPage(43);
        expect(router.state.location.pathname).toBe('/admin/dictionary/revisions/43');
        expect(router.state.historyAction).toBe('REPLACE');
    });

    test('從搜尋分析「建立詞條草稿」導過來時，詞形欄位用 location.state.prefillName 預填', async () => {
        renderEditor('/admin/dictionary/words/new', { prefillName: 'balay123' });

        await screen.findByText('尚未儲存');

        expect(screen.getByLabelText(/詞形/)).toHaveValue('balay123');
    });

    test('已建立的新詞條草稿再次儲存會 PUT 同一筆 revision', async () => {
        createWordProposal.mockResolvedValue({
            revision_id: 42,
            status: 'draft',
        });
        updateRevisionPayload.mockResolvedValue({
            id: 42,
            status: 'draft',
        });

        renderEditor();
        await screen.findByText('尚未儲存');

        // /族語/ 沒有錨定會同時比對到「族語」下拉選單跟「族語辭典詞條」
        // 這個布林勾選框的 label（is_zuzucidian），兩者都包含「族語」子字串
        // ——錨定開頭＋後面接空白，只有下拉選單的「族語 *」符合。
        fireEvent.change(screen.getByLabelText(/^族語\s/), {
            target: { value: 'tribe-tayal' },
        });
        fireEvent.change(screen.getByLabelText(/詞形/), {
            target: { value: 'lokah' },
        });
        fireEvent.click(screen.getByRole('button', {
            name: /儲存草稿/,
        }));

        await waitForRevisionPage(42);

        fireEvent.change(screen.getByLabelText(/拼音/), {
            target: { value: 'lo-kah' },
        });
        fireEvent.click(screen.getByRole('button', {
            name: /儲存草稿/,
        }));

        await waitFor(() => {
            expect(updateRevisionPayload).toHaveBeenCalledWith(
                42,
                expect.objectContaining({
                    name: 'lokah',
                    pinyin: 'lo-kah',
                }),
                { baseUpdatedAt: 'rev-updated-1' },
            );
        });

        expect(createWordProposal).toHaveBeenCalledTimes(1);
    });

    test('編輯正式詞條時帶回原始 base_hash 建立 update 提案', async () => {
        proposeWordUpdate.mockResolvedValue({
            revision_id: 51,
            status: 'draft',
        });

        renderEditor('/admin/dictionary/words/word-1');

        expect(await screen.findByDisplayValue('abas')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/詞形/), {
            target: { value: 'abas-new' },
        });
        fireEvent.click(screen.getByRole('button', {
            name: /儲存草稿/,
        }));

        await waitFor(() => {
            expect(proposeWordUpdate).toHaveBeenCalledWith(
                'word-1',
                expect.objectContaining({
                    name: 'abas-new',
                    base_hash: 'sha256:original',
                }),
            );
        });
    });

    test('既有詞條有 pending revision 時優先載入提案 payload', async () => {
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: {
                ...effectiveWord.meta,
                pending_revision: {
                    id: 31,
                    status: 'draft',
                    operation: 'update',
                },
            },
        });
        getRevision.mockResolvedValue({
            id: 31,
            status: 'draft',
            operation: 'update',
            payload: {
                ...effectiveWord,
                name: '提案中的詞形',
                dictionary_note: '尚未生效的內容',
            },
        });

        renderEditor('/admin/dictionary/words/word-1');

        expect(
            await screen.findByDisplayValue('提案中的詞形'),
        ).toBeInTheDocument();
        expect(
            screen.getByDisplayValue('尚未生效的內容'),
        ).toBeInTheDocument();
        expect(getRevision).toHaveBeenCalledWith(31);
    });

    test('409 衝突會引導使用者重新整理取得最新內容', async () => {
        const conflict = new Error('內容雜湊不一致');
        conflict.status = 409;
        proposeWordUpdate.mockRejectedValue(conflict);

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.click(screen.getByRole('button', {
            name: /儲存草稿/,
        }));

        expect(
            await screen.findByText(/請重新整理頁面取得最新狀態/),
        ).toBeInTheDocument();
    });

    test('送審中的提案為唯讀，editor 可撤回但不能儲存', async () => {
        mockRole = 'editor';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: {
                ...effectiveWord.meta,
                pending_revision: {
                    id: 31,
                    status: 'pending_review',
                    operation: 'update',
                },
            },
        });
        getRevision.mockResolvedValue({
            id: 31,
            status: 'pending_review',
            operation: 'update',
            payload: effectiveWord,
        });
        withdrawRevision.mockResolvedValue({
            id: 31,
            status: 'draft',
        });

        renderEditor('/admin/dictionary/words/word-1');

        expect(
            await screen.findByText(/此提案正在送審/),
        ).toBeInTheDocument();
        expect(screen.getByLabelText(/詞形/)).toBeDisabled();
        expect(screen.queryByRole('button', {
            name: /儲存草稿/,
        })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', {
            name: /撤回/,
        }));

        await waitFor(() => {
            expect(withdrawRevision).toHaveBeenCalledWith(31);
        });
    });

    /** useRevisionActions.js 原本沒有任何同步鎖：run() 只在動作開始時
     * setPending(true)，沒有 if (pending) return 這種擋同一個 tick 內重複
     * 觸發的檢查，完全依賴 disabled 屬性——但 state 要下一次 render 才會
     * 反映到畫面上，擋不住「送審」跟「捨棄草稿」這兩個不同按鈕在同一個
     * tick 內都被觸發。這裡驗證 useRevisionActions 內部所有動作共用的
     * ref 鎖真的擋住了這種情況（跨 hook 的 saveDraft/createDeleteProposal
     * 是否也共用同一把鎖，由 useWordEditorData.test.js 另外驗證）。 */
    test('送審與捨棄草稿在同一個 tick 內都被觸發時，只有一個會真的送出', async () => {
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: {
                ...effectiveWord.meta,
                pending_revision: { id: 31, status: 'draft', operation: 'update' },
            },
        });
        getRevision.mockResolvedValue({
            id: 31,
            status: 'draft',
            operation: 'update',
            payload: effectiveWord,
        });
        submitRevision.mockResolvedValue({ id: 31, status: 'pending_review' });
        discardRevision.mockResolvedValue({ detail: '已捨棄' });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        const submitButton = screen.getByRole('button', { name: /^送審/ });
        const discardButton = screen.getByRole('button', { name: /捨棄草稿/ });

        // 包在同一個 act() 裡，讓兩個按鈕的 click handler 在 React 重新
        // render、更新 disabled 屬性之前就都執行——分開呼叫 fireEvent.click
        // 時，RTL 會各自用 act() 包一次，兩次呼叫之間 React 已經重新
        // render，第二顆按鈕在真正點選前就已經被 disabled 擋下，測不出
        // useActionLock 本身的保護，只測到 React 正常的重新渲染時序。
        act(() => {
            fireEvent.click(submitButton);
            fireEvent.click(discardButton);
        });

        await waitFor(() => {
            expect(submitRevision).toHaveBeenCalledTimes(1);
        });
        expect(discardRevision).not.toHaveBeenCalled();
    });

    /** 回歸測試：discard 成功後後端只回 { detail: '已捨棄' }，沒有 id/
     * status/payload。handleRevisionChanged 原本一律用 revisionFromSave
     * (result, current) 合併，等於把舊 revision 的欄位整個從 current 補
     * 回來——後端已經刪掉這筆 revision，畫面卻繼續顯示它存在。 */
    test('回歸測試：捨棄既有詞條的草稿後，重新載入正式內容，不殘留舊草稿', async () => {
        mockRole = 'editor';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: {
                ...effectiveWord.meta,
                pending_revision: { id: 31, status: 'draft', operation: 'update' },
            },
        });
        getRevision.mockResolvedValue({
            id: 31,
            status: 'draft',
            operation: 'update',
            payload: { ...effectiveWord, name: '草稿中的詞形' },
        });
        discardRevision.mockResolvedValue({ detail: '已捨棄' });

        renderEditor('/admin/dictionary/words/word-1');
        expect(await screen.findByDisplayValue('草稿中的詞形')).toBeInTheDocument();

        // 捨棄之後 getWord 會被重新呼叫一次，回傳的是正式內容（'abas'）。
        getWord.mockResolvedValue(effectiveWord);

        fireEvent.click(screen.getByRole('button', { name: /捨棄草稿/ }));

        await waitFor(() => {
            expect(discardRevision).toHaveBeenCalledWith(31);
        });

        expect(await screen.findByDisplayValue('abas')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('草稿中的詞形')).not.toBeInTheDocument();
        expect(screen.getByText('目前生效版本')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /捨棄草稿/ })).not.toBeInTheDocument();
    });

    test('回歸測試：捨棄新建詞條的草稿後，回到空白的「尚未儲存」表單', async () => {
        createWordProposal.mockResolvedValue({ revision_id: 42, status: 'draft' });
        discardRevision.mockResolvedValue({ detail: '已捨棄' });

        renderEditor();
        await screen.findByText('尚未儲存');

        fireEvent.change(screen.getByLabelText(/^族語\s/), { target: { value: 'tribe-tayal' } });
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: 'lokah' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await waitForRevisionPage(42);

        fireEvent.click(screen.getByRole('button', { name: /捨棄草稿/ }));

        await waitFor(() => {
            expect(discardRevision).toHaveBeenCalled();
        });

        // 稽核 FE7a-02：新建草稿已有專屬網址，捨棄後那個網址不存在了，回到詞條列表
        expect(await screen.findByText('詞條列表')).toBeInTheDocument();
    });

    /** 回歸測試：editable 原本沒有排除 operation === 'delete'，建立刪除
     * 提案後整份表單仍然可以編輯，「儲存草稿」還會把一般內容 payload 寫進
     * 這筆刪除提案裡。 */
    test('回歸測試：建立刪除提案後表單變成唯讀，不再顯示儲存草稿', async () => {
        proposeWordDelete.mockResolvedValue({
            revision_id: 91, status: 'draft', operation: 'delete',
        });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.click(screen.getByRole('button', { name: /建立刪除提案/ }));
        await screen.findByText(/標註引用/);
        fireEvent.click(screen.getByRole('button', { name: /確認建立刪除提案/ }));

        await waitFor(() => {
            expect(proposeWordDelete).toHaveBeenCalled();
        });

        expect(await screen.findByText(/已建立刪除提案，內容為唯讀/)).toBeInTheDocument();
        expect(screen.getByLabelText(/詞形/)).toBeDisabled();
        expect(screen.queryByRole('button', { name: /儲存草稿/ })).not.toBeInTheDocument();
    });

    test('reviewer 可核准或填寫意見後退件', async () => {
        mockRole = 'reviewer';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: {
                ...effectiveWord.meta,
                pending_revision: {
                    id: 31,
                    status: 'pending_review',
                    operation: 'update',
                },
            },
        });
        getRevision.mockResolvedValue({
            id: 31,
            status: 'pending_review',
            operation: 'update',
            payload: effectiveWord,
        });
        approveRevision.mockResolvedValue({
            id: 31,
            status: 'approved',
        });

        renderEditor('/admin/dictionary/words/word-1');

        await screen.findByText('審核提案');

        expect(screen.getByLabelText(/詞形/)).toBeDisabled();
        expect(screen.getByRole('button', {
            name: /退件/,
        })).toBeDisabled();

        fireEvent.change(screen.getByLabelText('審核意見'), {
            target: { value: '內容正確' },
        });
        fireEvent.click(screen.getByRole('button', {
            name: /核准/,
        }));

        await waitFor(() => {
            expect(approveRevision).toHaveBeenCalledWith(31, {
                reviewComment: '內容正確',
                baseUpdatedAt: undefined,
            });
        });
    });

    test(
        '完整巢狀路徑：新增解釋、例句、標註項目並搜尋選取連結詞條',
        async () => {
            createWordProposal.mockResolvedValue({
                revision_id: 80,
                status: 'draft',
            });
            listWords.mockResolvedValue({
                results: [{
                    id: 'linked-word',
                    name: 'na',
                    dialect: '',
                    pinyin: '',
                }],
                count: 1,
                page: 1,
                page_size: 20,
            });

            renderEditor();
            await screen.findByText('尚未儲存');

            fireEvent.change(screen.getByLabelText(/^族語\s/), {
                target: { value: 'tribe-tayal' },
            });
            fireEvent.change(screen.getByLabelText(/詞形/), {
                target: { value: '測試詞條' },
            });

            fireEvent.click(screen.getByRole('button', {
                name: /新增解釋/,
            }));
            fireEvent.change(screen.getByLabelText('中文解釋'), {
                target: { value: '測試解釋' },
            });
            fireEvent.click(screen.getByLabelText('動物'));

            fireEvent.click(screen.getByRole('button', {
                name: /新增例句/,
            }));
            fireEvent.change(screen.getByLabelText('原文'), {
                target: { value: 'na lokah' },
            });

            fireEvent.click(screen.getByRole('button', {
                name: /新增標註$/,
            }));
            fireEvent.click(screen.getByRole('button', {
                name: /新增標註項目/,
            }));

            fireEvent.change(screen.getByLabelText('項目文字 1'), {
                target: { value: 'na' },
            });
            fireEvent.change(screen.getByLabelText('連結詞條 1'), {
                target: { value: 'na' },
            });

            expect(
                await screen.findByRole('option', { name: /na/ }),
            ).toBeInTheDocument();

            fireEvent.click(screen.getByRole('option', {
                name: /na/,
            }));

            expect(
                screen.getByText('已連結：na'),
            ).toBeInTheDocument();

            fireEvent.click(screen.getByRole('button', {
                name: /儲存草稿/,
            }));

            await waitFor(() => {
                expect(createWordProposal).toHaveBeenCalledWith(
                    expect.objectContaining({
                        explanations: [
                            expect.objectContaining({
                                chinese_explanation: '測試解釋',
                                category_ids: [7],
                                sentences: [
                                    expect.objectContaining({
                                        original_sentence: 'na lokah',
                                        anaphoras: [
                                            expect.objectContaining({
                                                items: [
                                                    expect.objectContaining({
                                                        name: 'na',
                                                        word_id: 'linked-word',
                                                        word_name: 'na',
                                                    }),
                                                ],
                                            }),
                                        ],
                                    }),
                                ],
                            }),
                        ],
                    }),
                );
            });
        },
        5000,
    );

    test('owner 建立刪除提案時可選擇一併解除引用', async () => {
        getWordReferences.mockResolvedValue({
            counts: {
                anaphora_items: 14,
                grammar_example_words: 0,
            },
            sample: [{
                word_id: 'sample-word',
                word_name: 'na',
                sentence: 'na lokah',
            }],
        });
        proposeWordDelete.mockResolvedValue({
            revision_id: 91,
            status: 'draft',
            operation: 'delete',
        });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.click(screen.getByRole('button', {
            name: /建立刪除提案/,
        }));

        expect(
            await screen.findByText(/標註引用：14/),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText(
            '核准刪除時一併解除所有引用',
        ));
        fireEvent.click(screen.getByRole('button', {
            name: /確認建立刪除提案/,
        }));

        await waitFor(() => {
            expect(proposeWordDelete).toHaveBeenCalledWith(
                'word-1',
                true,
            );
        });
    });

    test('稽核 FE7a-01：詳情的 open_revision（草稿）會被載入，而不是只看送審中的', async () => {
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 33, status: 'draft', operation: 'update', updated_at: 'u33',
            payload: { ...effectiveWord, name: '我的草稿' },
        });
        updateRevisionPayload.mockResolvedValue({ id: 33, updated_at: 'u34' });

        renderEditor('/admin/dictionary/words/word-1');
        expect(await screen.findByDisplayValue('我的草稿')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await waitFor(() => {
            expect(updateRevisionPayload).toHaveBeenCalledWith(33, expect.anything(), { baseUpdatedAt: 'u33' });
        });
        expect(proposeWordUpdate).not.toHaveBeenCalled();
    });

    test('稽核 FE7a-03／07：刪除提案表單顯示目前內容，並標示是否解除引用與引用數', async () => {
        mockRole = 'reviewer';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 35, status: 'pending_review', operation: 'delete' } },
        });
        getRevision.mockResolvedValue({
            id: 35, status: 'pending_review', operation: 'delete', updated_at: 'u35',
            payload: { unlink_references: true },
            reference_counts: { anaphora_items: 4, grammar_example_words: 1 },
        });

        renderEditor('/admin/dictionary/words/word-1');

        expect(await screen.findByDisplayValue('abas')).toBeInTheDocument();
        const info = screen.getByTestId('revision-delete-info');
        expect(info).toHaveTextContent('這是刪除提案');
        expect(info).toHaveTextContent('核准時一併解除引用：是');
        expect(info).toHaveTextContent('標註 4 筆、文法例句 1 筆');
        // WP-8 追加：限制只在提出端，reviewer 可以核准會解除引用的刪除提案（原本這裡測的是按鈕停用）；
        // 畫面提醒核准會一併解除引用，並說明這個選項由誰設定
        expect(screen.queryByText(/只有擁有者或管理員可以核准/)).not.toBeInTheDocument();
        expect(screen.getByText(/核准後除了刪除詞條/)).toBeInTheDocument();
        expect(info).toHaveTextContent('審核者核准即代表同意解除這些引用');
        expect(screen.getByRole('button', { name: /核准/ })).toBeEnabled();
    });

    test('WP-8 追加：reviewer 核准會解除引用的刪除提案時照常送出', async () => {
        mockRole = 'reviewer';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 35, status: 'pending_review', operation: 'delete' } },
        });
        getRevision.mockResolvedValue({
            id: 35, status: 'pending_review', operation: 'delete', updated_at: 'u35',
            payload: { unlink_references: true }, reference_counts: { anaphora_items: 2, grammar_example_words: 0 },
        });
        approveRevision.mockResolvedValue({ id: 35, status: 'approved' });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.click(screen.getByRole('button', { name: /核准/ }));
        await waitFor(() => {
            expect(approveRevision).toHaveBeenCalledWith(35, { reviewComment: '', baseUpdatedAt: 'u35' });
        });
    });

    test('稽核 FE7a-07：owner 可核准會解除引用的刪除提案，並帶載入時的 updated_at', async () => {
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 35, status: 'pending_review', operation: 'delete' } },
        });
        getRevision.mockResolvedValue({
            id: 35, status: 'pending_review', operation: 'delete', updated_at: 'u35',
            payload: { unlink_references: true }, reference_counts: { anaphora_items: 0, grammar_example_words: 0 },
        });
        approveRevision.mockResolvedValue({ id: 35, status: 'approved' });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.click(screen.getByRole('button', { name: /核准/ }));
        await waitFor(() => {
            expect(approveRevision).toHaveBeenCalledWith(35, { reviewComment: '', baseUpdatedAt: 'u35' });
        });
    });

    test('稽核 FE7a-13：審核更新提案時列出與現行版本的差異', async () => {
        mockRole = 'reviewer';
        getWord.mockResolvedValue({
            ...effectiveWord,
            explanations: [{ id: 5, chinese_explanation: '舊解釋', sentences: [], images: [] }],
            meta: { ...effectiveWord.meta, pending_revision: { id: 36, status: 'pending_review', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 36, status: 'pending_review', operation: 'update', updated_at: 'u36',
            payload: {
                ...effectiveWord,
                pinyin: 'a-bas',
                explanations: [{ id: 5, chinese_explanation: '新解釋', sentences: [], images: [] }],
                audios: [{ id: null, file_id: 'x.mp3', audio_class: '' }],
            },
        });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByText('審核提案');

        const summary = screen.getByRole('region', { name: '變更摘要' });
        expect(summary).toHaveTextContent('修改「拼音」');
        expect(summary).toHaveTextContent('解釋 1 › 修改「中文解釋」');
        expect(summary).toHaveTextContent('新增詞條音檔 1');
        expect(summary).not.toHaveTextContent('詞形');
    });

    test('稽核 FE7a-06：草稿 PUT 遇到 edit_conflict 時提供載入最新內容，不會無聲覆蓋', async () => {
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValueOnce({
            id: 33, status: 'draft', operation: 'update', updated_at: 'u1', payload: effectiveWord,
        });
        const conflict = new Error('內容已被其他人更新');
        conflict.status = 409;
        conflict.data = { code: 'edit_conflict' };
        updateRevisionPayload.mockRejectedValueOnce(conflict);

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: '我的版本' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        expect(await screen.findByText(/這份草稿在你編輯期間已被修改/)).toBeInTheDocument();

        getRevision.mockResolvedValueOnce({
            id: 33, status: 'draft', operation: 'update', updated_at: 'u2',
            payload: { ...effectiveWord, name: '別人的版本' },
        });
        fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
        expect(await screen.findByDisplayValue('別人的版本')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '改回我的版本' }));
        expect(await screen.findByDisplayValue('我的版本')).toBeInTheDocument();
    });

    test('WP-8 追加：propose 撞到載入後才出現的他人草稿（409 附 revision_id）時，可載入那份草稿，之後改走 PUT 並帶樂觀鎖', async () => {
        getWord.mockResolvedValue(effectiveWord);
        const conflict = new Error('這個項目已經有一份其他人建立的草稿');
        conflict.status = 409;
        conflict.data = { code: 'edit_conflict', revision_id: 44 };
        proposeWordUpdate.mockRejectedValueOnce(conflict);

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: '我的版本' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        expect(await screen.findByText(/這份草稿在你編輯期間已被修改/)).toBeInTheDocument();

        getRevision.mockResolvedValueOnce({
            id: 44, status: 'draft', operation: 'update', updated_at: 'u44', created_by: 'alice',
            payload: { ...effectiveWord, name: '別人的版本' },
        });
        fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
        expect(await screen.findByDisplayValue('別人的版本')).toBeInTheDocument();
        expect(getRevision).toHaveBeenLastCalledWith(44);

        fireEvent.click(screen.getByRole('button', { name: '改回我的版本' }));
        await screen.findByDisplayValue('我的版本');
        updateRevisionPayload.mockResolvedValueOnce({ revision_id: 44, payload: {}, updated_at: 'u45' });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await waitFor(() => expect(updateRevisionPayload).toHaveBeenCalledWith(
            44, expect.anything(), { baseUpdatedAt: 'u44' },
        ));
        expect(proposeWordUpdate).toHaveBeenCalledTimes(1);
    });

    test('稽核 FE7a-09：捨棄草稿取消確認時不呼叫 API', async () => {
        confirmAction.mockResolvedValue(false);
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({ id: 33, status: 'draft', operation: 'update', payload: effectiveWord });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        fireEvent.click(screen.getByRole('button', { name: /捨棄草稿/ }));

        await waitFor(() => expect(confirmAction).toHaveBeenCalled());
        expect(discardRevision).not.toHaveBeenCalled();
    });

    test('稽核 FE7a-02：以提案網址開啟新建詞條提案並可核准，核准後導到正式詞條', async () => {
        mockRole = 'reviewer';
        getRevision.mockResolvedValue({
            id: 77, target_kind: 'word', target_id: '', status: 'pending_review', operation: 'create',
            updated_at: 'u77', payload: { ...effectiveWord, name: '新詞提案' },
        });
        approveRevision.mockResolvedValue({ id: 77, status: 'approved', target_id: 'word-1' });

        renderEditor('/admin/dictionary/revisions/77');

        expect(await screen.findByDisplayValue('新詞提案')).toBeInTheDocument();
        expect(screen.getByText(/這是新建詞條的提案/)).toBeInTheDocument();
        expect(getWord).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /核准/ }));
        await waitFor(() => {
            expect(approveRevision).toHaveBeenCalledWith(77, { reviewComment: '', baseUpdatedAt: 'u77' });
        });
        await waitFor(() => expect(getWord).toHaveBeenCalledWith('word-1'));
    });

    test('稽核 FE7a-02：提案網址指向既有詞條時導到詞條頁', async () => {
        getRevision.mockResolvedValue({
            id: 31, target_kind: 'word', target_id: 'word-1', status: 'draft', operation: 'update', payload: effectiveWord,
        });

        renderEditor('/admin/dictionary/revisions/31');

        expect(await screen.findByText('詞條詳情')).toBeInTheDocument();
        expect(getWord).toHaveBeenCalledWith('word-1');
    });

    test('稽核 FE7a-04：有未儲存變更時點返回連結會先確認，取消則留在頁面', async () => {
        confirmAction.mockResolvedValue(false);
        const router = renderEditorInDataRouter('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: 'changed' } });
        fireEvent.click(screen.getByRole('button', { name: /返回詞條列表/ }));

        await waitFor(() => expect(confirmAction).toHaveBeenCalled());
        expect(screen.queryByText('詞條列表')).not.toBeInTheDocument();
        expect(screen.getByDisplayValue('changed')).toBeInTheDocument();
        expect(router.state.location.pathname).toBe('/admin/dictionary/words/word-1');

        confirmAction.mockResolvedValue(true);
        fireEvent.click(screen.getByRole('button', { name: /返回詞條列表/ }));
        expect(await screen.findByText('詞條列表')).toBeInTheDocument();
    });

    test('稽核 FE7a-04：瀏覽器上一頁一樣會先確認', async () => {
        confirmAction.mockResolvedValue(false);
        const router = createMemoryRouter([{
            path: '*',
            element: (
                <Routes>
                    <Route path="/admin/dictionary/words/:id" element={<WordEditor />} />
                    <Route path="/admin/dictionary/words" element={<div>詞條列表</div>} />
                </Routes>
            ),
        }], { initialEntries: ['/admin/dictionary/words', '/admin/dictionary/words/word-1'], initialIndex: 1 });
        render(<RouterProvider router={router} />);
        await screen.findByDisplayValue('abas');
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: 'changed' } });

        act(() => { router.navigate(-1); });
        await waitFor(() => expect(confirmAction).toHaveBeenCalled());
        // 取消後 blocker 回到待命（reset），沒有卡在 blocked
        await waitFor(() => expect([...router.state.blockers.values()].every((b) => b.state === 'unblocked')).toBe(true));
        expect(router.state.location.pathname).toBe('/admin/dictionary/words/word-1');
        expect(screen.getByDisplayValue('changed')).toBeInTheDocument();
    });

    test('稽核 FE7a-02／FE7a-04：新建草稿存檔後換到提案網址，不會被自己的未儲存保護攔下', async () => {
        createWordProposal.mockResolvedValue({ revision_id: 42, status: 'draft' });
        const router = renderEditorInDataRouter('/admin/dictionary/words/new');
        await screen.findByText('尚未儲存');

        fireEvent.change(screen.getByLabelText(/^族語\s/), { target: { value: 'tribe-tayal' } });
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: 'lokah' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        await waitForRevisionPage(42);
        expect(router.state.location.pathname).toBe('/admin/dictionary/revisions/42');
        expect(confirmAction).not.toHaveBeenCalled();
    });

    test('稽核 FE7a-04：沒有未儲存變更時直接離開，不跳確認', async () => {
        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.click(screen.getByRole('button', { name: /返回詞條列表/ }));
        expect(await screen.findByText('詞條列表')).toBeInTheDocument();
        expect(confirmAction).not.toHaveBeenCalled();
    });

    test('稽核 FE7a-04：有未儲存變更時註冊 beforeunload 離開確認', async () => {
        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        const before = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(before);
        expect(before.defaultPrevented).toBe(false);

        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: 'changed' } });
        const after = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(true);
    });

    test('稽核 FE7a-08：媒體上傳中停用儲存草稿與送審，並說明原因', async () => {
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({ id: 33, status: 'draft', operation: 'update', payload: effectiveWord });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.click(screen.getByRole('button', { name: /新增詞條音檔/ }));
        fireEvent.change(screen.getByLabelText('詞條音檔 1'), { target: { value: '__uploading__' } });

        expect(await screen.findByText(/檔案上傳中，完成後才能儲存草稿或送審/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /儲存草稿/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^送審/ })).toBeDisabled();

        fireEvent.change(screen.getByLabelText('詞條音檔 1'), { target: { value: 'done.mp3' } });
        await waitFor(() => expect(screen.getByRole('button', { name: /儲存草稿/ })).toBeEnabled());
        expect(screen.queryByText(/檔案上傳中/)).not.toBeInTheDocument();
    });

    test('稽核 FE7a-08：上傳中的欄位被移除時不會讓儲存一直停用', async () => {
        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        fireEvent.click(screen.getByRole('button', { name: /新增詞條音檔/ }));
        fireEvent.change(screen.getByLabelText('詞條音檔 1'), { target: { value: '__uploading__' } });
        await waitFor(() => expect(screen.getByRole('button', { name: /儲存草稿/ })).toBeDisabled());

        fireEvent.click(screen.getByRole('button', { name: /刪除音檔/ }));
        await waitFor(() => expect(screen.getByRole('button', { name: /儲存草稿/ })).toBeEnabled());
    });

    test('稽核 WP-8 驗證：別人建立的草稿為唯讀，顯示提示且不能送審或捨棄', async () => {
        mockRole = 'editor';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 33, status: 'draft', operation: 'update', created_by: 'alice', payload: effectiveWord,
        });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');

        expect(screen.getByText('這是 alice 建立的草稿，你無法修改。')).toBeInTheDocument();
        expect(screen.getByLabelText(/詞形/)).toBeDisabled();
        expect(screen.queryByRole('button', { name: /儲存草稿/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^送審/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /捨棄草稿/ })).not.toBeInTheDocument();
    });

    test('稽核 WP-8 驗證：別人送審中的提案，一般編輯者看不到撤回', async () => {
        mockRole = 'editor';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'pending_review', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 33, status: 'pending_review', operation: 'update', created_by: 'alice', submitted_by: 'alice',
            payload: effectiveWord,
        });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        expect(screen.queryByRole('button', { name: /撤回/ })).not.toBeInTheDocument();
        // WP-8 追加（已知小問題 b）：看不到撤回鈕的人，提示不能叫他「先撤回」
        expect(screen.queryByText(/可以先撤回提案再修改/)).not.toBeInTheDocument();
        expect(screen.getByText(/只有建立者 alice或擁有者／管理員可以撤回後修改/)).toBeInTheDocument();
    });

    test('WP-8 追加：送審者本人看到「可以先撤回」，提示與撤回鈕一致', async () => {
        mockRole = 'editor';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'pending_review', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 33, status: 'pending_review', operation: 'update', created_by: 'alice', submitted_by: 'me',
            payload: effectiveWord,
        });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        expect(screen.getByRole('button', { name: /撤回/ })).toBeInTheDocument();
        expect(screen.getByText('此提案正在送審，欄位為唯讀；可以先撤回提案再修改。')).toBeInTheDocument();
    });

    test('WP-8 追加：他人草稿與送審中提示顯示姓名，沒有姓名時退回 uid', async () => {
        mockRole = 'editor';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'pending_review', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 33, status: 'pending_review', operation: 'update',
            created_by: 'alice', created_by_name: '王小美', submitted_by: 'carol', submitted_by_name: '',
            payload: effectiveWord,
        });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        expect(screen.getByText(/只有建立者 王小美、送審者 carol或擁有者／管理員可以撤回後修改/)).toBeInTheDocument();
    });

    test('WP-8 追加：別人的草稿提示顯示建立者姓名', async () => {
        mockRole = 'editor';
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 33, status: 'draft', operation: 'update', created_by: 'alice', created_by_name: '王小美',
            payload: effectiveWord,
        });

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        expect(screen.getByText('這是 王小美 建立的草稿，你無法修改。')).toBeInTheDocument();
    });

    test('稽核 FE7a-05 殘留：後端驗證錯誤對應回欄位顯示 isInvalid，改了欄位就清掉', async () => {
        const error = new Error('請求參數錯誤');
        error.status = 400;
        error.data = { errors: { name: '不可超過 100 字', 'explanations[0].chinese_explanation': '為必填' } };
        proposeWordUpdate.mockRejectedValueOnce(error);

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        const nameInput = screen.getByLabelText(/詞形/);
        await waitFor(() => expect(nameInput).toHaveClass('is-invalid'));
        expect(screen.getByText('不可超過 100 字', { selector: '.invalid-feedback' })).toBeInTheDocument();
        // 對不到單一欄位的巢狀錯誤仍攤平在頁首
        expect(screen.getByText(/為必填/, { selector: '.alert' })).toBeInTheDocument();
        expect(screen.getByLabelText(/方言別/)).not.toHaveClass('is-invalid');

        fireEvent.change(nameInput, { target: { value: 'abas2' } });
        expect(nameInput).not.toHaveClass('is-invalid');
    });

    test('稽核 FE7a-05 殘留：前端必填檢查也標在欄位上', async () => {
        renderEditor('/admin/dictionary/words/new');
        await screen.findByLabelText(/詞形/);
        const tribeSelect = document.getElementById('dictionary-word-tribe');
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: 'abas' } });
        fireEvent.submit(tribeSelect.closest('form'));
        await waitFor(() => expect(tribeSelect).toHaveClass('is-invalid'));
        expect(createWordProposal).not.toHaveBeenCalled();
    });

    test('稽核 WP-8 驗證：自己的草稿與 owner 開別人的草稿都可以編輯', async () => {
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 33, status: 'draft', operation: 'update', created_by: 'alice', payload: effectiveWord,
        });

        renderEditor('/admin/dictionary/words/word-1');  // mockRole 預設 owner
        await screen.findByDisplayValue('abas');
        expect(screen.getByLabelText(/詞形/)).toBeEnabled();
        expect(screen.queryByText(/建立的草稿，你無法修改/)).not.toBeInTheDocument();
    });

    test('稽核 WP-8 驗證：以提案網址開別人的新建草稿也是唯讀', async () => {
        mockRole = 'editor';
        getRevision.mockResolvedValue({
            id: 78, target_kind: 'word', target_id: '', status: 'draft', operation: 'create',
            created_by: 'alice', payload: { ...effectiveWord, name: '別人的新詞' },
        });

        renderEditor('/admin/dictionary/revisions/78');
        expect(await screen.findByDisplayValue('別人的新詞')).toBeDisabled();
        expect(screen.getByText('這是 alice 建立的草稿，你無法修改。')).toBeInTheDocument();
    });

    test('稽核 WP-8 驗證：「改回我的版本」後仍視為未儲存，離開會提醒', async () => {
        getWord.mockResolvedValue({
            ...effectiveWord,
            meta: { ...effectiveWord.meta, open_revision: { id: 33, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValueOnce({
            id: 33, status: 'draft', operation: 'update', updated_at: 'u1', payload: effectiveWord,
        });
        const conflict = new Error('內容已被其他人更新');
        conflict.status = 409;
        conflict.data = { code: 'edit_conflict' };
        updateRevisionPayload.mockRejectedValueOnce(conflict);

        renderEditor('/admin/dictionary/words/word-1');
        await screen.findByDisplayValue('abas');
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: '我的版本' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));
        await screen.findByText(/這份草稿在你編輯期間已被修改/);

        getRevision.mockResolvedValueOnce({
            id: 33, status: 'draft', operation: 'update', updated_at: 'u2',
            payload: { ...effectiveWord, name: '別人的版本' },
        });
        fireEvent.click(screen.getByRole('button', { name: '載入最新內容' }));
        await screen.findByDisplayValue('別人的版本');
        fireEvent.click(screen.getByRole('button', { name: '改回我的版本' }));
        await screen.findByDisplayValue('我的版本');

        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    test('新建草稿換網址後的成功訊息只顯示一次，route state 會被清掉', async () => {
        createWordProposal.mockResolvedValue({ revision_id: 42, status: 'draft' });

        renderEditor();
        await screen.findByText('尚未儲存');
        fireEvent.change(screen.getByLabelText(/^族語\s/), { target: { value: 'tribe-tayal' } });
        fireEvent.change(screen.getByLabelText(/詞形/), { target: { value: 'lokah' } });
        fireEvent.click(screen.getByRole('button', { name: /儲存草稿/ }));

        await waitForRevisionPage(42);
        expect(screen.getByText('草稿已儲存')).toBeInTheDocument();
        // flash 清掉後不會觸發重新載入（提案只讀一次）
        await waitFor(() => {
            expect(getRevision.mock.calls.filter(([id]) => String(id) === '42')).toHaveLength(1);
        });
    });

    test('返回按鈕依專案實際行為使用 button role', async () => {
        renderEditor();

        await screen.findByText('尚未儲存');

        const backButton = screen.getByRole('button', {
            name: /返回詞條列表/,
        });

        expect(backButton).toHaveAttribute(
            'href',
            '/admin/dictionary/words',
        );
    });
});
