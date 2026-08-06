// frontend/src/_admin/dictionary/WordEditor.test.jsx
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
} from '@testing-library/react';
import {
    MemoryRouter,
    Route,
    Routes,
} from 'react-router-dom';
import WordEditor from './WordEditor';
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
}));

vi.mock('./MediaUploadField', () => ({
    default: ({
        kind,
        label,
        value,
        onChange,
        disabled,
    }) => (
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
    ),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({
        userData: { role: mockRole },
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

const renderEditor = (path = '/admin/dictionary/words/new') => render(
    <MemoryRouter initialEntries={[path]}>
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
        </Routes>
    </MemoryRouter>,
);

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

        listTaxonomies.mockResolvedValue(taxonomies);
        getWord.mockResolvedValue(effectiveWord);
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

        expect(
            await screen.findByText('草稿已儲存'),
        ).toBeInTheDocument();
        expect(screen.getByText('草稿')).toBeInTheDocument();
        expect(screen.getByRole('button', {
            name: '送審',
        })).toBeInTheDocument();
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

        await screen.findByText('草稿已儲存');

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
            await screen.findByText(/請重新整理頁面取得最新內容/),
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

            fireEvent.mouseDown(screen.getByRole('option', {
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
