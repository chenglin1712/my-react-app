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
    within,
} from '@testing-library/react';
import {
    MemoryRouter,
    Route,
    Routes,
} from 'react-router-dom';
import ImportWizard from './ImportWizard';
import {
    approveImportJob,
    autoCreateImportTaxonomies,
    exportDictionary,
    getImportJob,
    listImportJobs,
    listTaxonomies,
    preflightImportJob,
    rejectImportJob,
    submitImportJob,
    uploadImportJob,
    withdrawImportJob,
} from './dictionaryApi';
import { confirmAction } from '@components/ui/ConfirmDialog';

// 稽核 FE7a-09：核准與自動建立主檔改經 confirmAction，測試裡預設按「確認」
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: vi.fn(() => Promise.resolve(true)) }));

vi.mock('./dictionaryApi', () => ({
    approveImportJob: vi.fn(),
    autoCreateImportTaxonomies: vi.fn(),
    exportDictionary: vi.fn(),
    getImportJob: vi.fn(),
    listImportJobs: vi.fn(),
    listTaxonomies: vi.fn(),
    preflightImportJob: vi.fn(),
    rejectImportJob: vi.fn(),
    submitImportJob: vi.fn(),
    uploadImportJob: vi.fn(),
    withdrawImportJob: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const taxonomies = {
    tribes: [
        { id: 'tribe-tayal', slug: 'tayal', name: '泰雅語' },
        { id: 'tribe-amis', slug: 'amis', name: '阿美語' },
    ],
};

const report = {
    new_count: 1,
    update_count: 1,
    error_count: 1,
    items: [
        {
            row: 1, name: 'lokah', action: 'create', word_id: null, errors: [], payload: {},
        },
        {
            row: 2, name: 'maku', action: 'update', word_id: 'word-2', errors: [], payload: {},
        },
        {
            row: 3, name: 'bad-row', action: 'error', word_id: null, errors: ['找不到分類：植物'], payload: null,
        },
    ],
};

const baseJob = {
    id: 42,
    filename: 'tayal.json',
    tribe: 'tayal',
    status: 'uploaded',
    word_count: 3,
    new_count: 0,
    update_count: 0,
    error_count: 0,
    applied_count: 0,
    failed_count: 0,
    uploaded_by: 'editor@example.com',
    uploaded_at: '2026-08-05T10:00:00Z',
    reviewed_by: null,
    reviewed_at: null,
    review_comment: '',
    applied_by: null,
    applied_at: null,
    payload: {},
    report: null,
};

const jobForStatus = (status, overrides = {}) => ({
    ...baseJob,
    status,
    ...(status === 'uploaded' ? {} : { new_count: 1, update_count: 1, error_count: 1, report }),
    ...overrides,
});

const renderWizard = (path = '/admin/dictionary/import') => render(
    <MemoryRouter initialEntries={[path]}>
        <Routes>
            <Route path="/admin/dictionary/import" element={<ImportWizard />} />
            <Route path="/admin/dictionary/import/:id" element={<ImportWizard />} />
        </Routes>
    </MemoryRouter>,
);

describe('ImportWizard', () => {
    beforeEach(() => {
        mockRole = 'owner';

        [
            approveImportJob, autoCreateImportTaxonomies, exportDictionary, getImportJob,
            listImportJobs, listTaxonomies, preflightImportJob, rejectImportJob,
            submitImportJob, uploadImportJob, withdrawImportJob,
        ].forEach((mock) => mock.mockReset());

        confirmAction.mockReset();
        confirmAction.mockResolvedValue(true);
        listTaxonomies.mockResolvedValue(taxonomies);
        listImportJobs.mockResolvedValue({
            results: [], count: 0, page: 1, page_size: 20,
        });
        getImportJob.mockResolvedValue(baseJob);
    });

    test('新頁面顯示上傳步驟與匯出面板', async () => {
        renderWizard();

        expect(await screen.findByText('步驟一：上傳檔案')).toBeInTheDocument();
        expect(screen.getByText('匯出辭典')).toBeInTheDocument();
        expect(screen.getByLabelText('JSON 匯入檔案')).toBeInTheDocument();
    });

    test('選擇無效 JSON 顯示錯誤且不呼叫上傳 API', async () => {
        renderWizard();
        await screen.findByText('步驟一：上傳檔案');

        const file = new File(['{ invalid json'], 'broken.json', { type: 'application/json' });

        fireEvent.change(screen.getByLabelText('JSON 匯入檔案'), { target: { files: [file] } });

        expect(await screen.findByText('檔案不是有效的 JSON')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '上傳' })).toBeDisabled();
        expect(uploadImportJob).not.toHaveBeenCalled();
    });

    test('稽核 BE2b-11：原始檔過大時不讀取，直接提示分批匯入', async () => {
        renderWizard();
        await screen.findByText('步驟一：上傳檔案');

        const file = new File(['{}'], 'huge.json', { type: 'application/json' });
        Object.defineProperty(file, 'size', { value: 60 * 1024 * 1024 });

        fireEvent.change(screen.getByLabelText('JSON 匯入檔案'), { target: { files: [file] } });

        expect(await screen.findByText(/檔案過大.*分批匯入/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '上傳' })).toBeDisabled();
    });

    test('稽核 BE2b-11：送出內容超過 10 MB 上限時顯示錯誤，上傳鈕維持停用', async () => {
        class FakeFileReader {
            readAsText() {
                FakeFileReader.instance = this;
            }
        }
        const OriginalFileReader = window.FileReader;
        window.FileReader = FakeFileReader;

        try {
            renderWizard();
            await screen.findByText('步驟一：上傳檔案');

            const file = new File(['{}'], 'big.json', { type: 'application/json' });
            fireEvent.change(screen.getByLabelText('JSON 匯入檔案'), { target: { files: [file] } });

            const big = JSON.stringify({ tribe: 'tayal', words: ['x'.repeat(11 * 1024 * 1024)] });
            await act(async () => {
                FakeFileReader.instance.result = big;
                FakeFileReader.instance.onload();
            });

            expect(screen.getByText(/單次匯入上限為 10.0 MB/)).toBeInTheDocument();
            expect(screen.getByRole('button', { name: '上傳' })).toBeDisabled();
            expect(uploadImportJob).not.toHaveBeenCalled();
        } finally {
            window.FileReader = OriginalFileReader;
        }
    });

    test('回歸測試：快速換選兩個檔案時，較晚完成的 FileReader 不會蓋掉後選檔案的內容', async () => {
        class FakeFileReader {
            readAsText(file) {
                this.file = file;
                FakeFileReader.pending.push(this);
            }

            finish(content) {
                this.result = content;
                this.onload?.();
            }
        }
        FakeFileReader.pending = [];

        const OriginalFileReader = window.FileReader;
        window.FileReader = FakeFileReader;

        try {
            uploadImportJob.mockResolvedValue({ id: 42, row_errors: {} });

            renderWizard();
            await screen.findByText('步驟一：上傳檔案');

            const fileA = new File(['{"tribe":"a"}'], 'a.json', { type: 'application/json' });
            const fileB = new File(['{"tribe":"b"}'], 'b.json', { type: 'application/json' });

            const input = screen.getByLabelText('JSON 匯入檔案');
            fireEvent.change(input, { target: { files: [fileA] } });
            fireEvent.change(input, { target: { files: [fileB] } });

            expect(FakeFileReader.pending).toHaveLength(2);
            const [readerA, readerB] = FakeFileReader.pending;

            // 後選的 B 先完成，先選、已經不是目前選取檔案的 A 比較晚完成。
            await act(async () => { readerB.finish('{"tribe":"b"}'); });
            await act(async () => { readerA.finish('{"tribe":"a"}'); });

            fireEvent.click(screen.getByRole('button', { name: '上傳' }));

            await waitFor(() => {
                expect(uploadImportJob).toHaveBeenCalledWith('b.json', { tribe: 'b' });
            });
        } finally {
            window.FileReader = OriginalFileReader;
        }
    });

    test('有效 JSON 上傳時傳送解析後物件並導向工作頁', async () => {
        uploadImportJob.mockResolvedValue({ id: 42, row_errors: {} });

        renderWizard();
        await screen.findByText('步驟一：上傳檔案');

        const bundle = { tribe: 'tayal', words: [{ name: 'lokah' }] };
        const file = new File([JSON.stringify(bundle)], 'tayal.json', { type: 'application/json' });

        fireEvent.change(screen.getByLabelText('JSON 匯入檔案'), { target: { files: [file] } });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: '上傳' })).toBeEnabled();
        });

        fireEvent.click(screen.getByRole('button', { name: '上傳' }));

        await waitFor(() => {
            expect(uploadImportJob).toHaveBeenCalledWith('tayal.json', bundle);
        });

        expect(await screen.findByText('步驟二：檢視解析結果')).toBeInTheDocument();
        expect(getImportJob).toHaveBeenCalledWith('42');
    });

    test('uploaded 工作顯示預檢控制並可執行預檢', async () => {
        const validated = jobForStatus('validated');
        preflightImportJob.mockResolvedValue(validated);

        renderWizard('/admin/dictionary/import/42');

        expect(await screen.findByText('步驟二：檢視解析結果')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '下一步：預檢' }));

        await waitFor(() => {
            expect(preflightImportJob).toHaveBeenCalledWith('42');
        });

        expect(await screen.findByText('步驟三：預檢報告')).toBeInTheDocument();
    });

    test('validated 工作送出審核時呼叫專用 API', async () => {
        getImportJob.mockResolvedValue(jobForStatus('validated'));
        submitImportJob.mockResolvedValue(jobForStatus('pending_review'));

        renderWizard('/admin/dictionary/import/42');

        expect(await screen.findByText('步驟三：預檢報告')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '送出審核' }));

        await waitFor(() => {
            expect(submitImportJob).toHaveBeenCalledWith('42');
        });

        expect(await screen.findByText('審核中')).toBeInTheDocument();
    });

    test('owner 在有錯誤時可自動建立缺漏主檔', async () => {
        const validated = jobForStatus('validated');

        getImportJob.mockResolvedValue(validated);
        autoCreateImportTaxonomies.mockResolvedValue({
            ...validated,
            created_taxonomies: {
                source: [], category: ['植物', '動物'], part_of_speech: ['名詞'], focus: [],
            },
        });

        renderWizard('/admin/dictionary/import/42');

        const button = await screen.findByRole('button', { name: '自動建立缺漏主檔' });
        fireEvent.click(button);

        await waitFor(() => {
            expect(autoCreateImportTaxonomies).toHaveBeenCalledWith('42');
        });

        expect(await screen.findByText('已建立分類：植物、動物；詞性：名詞')).toBeInTheDocument();
        expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({ title: '自動建立缺漏主檔' }));
    });

    test('稽核 FE7a-09：自動建立缺漏主檔取消確認時不呼叫 API', async () => {
        confirmAction.mockResolvedValue(false);
        getImportJob.mockResolvedValue(jobForStatus('validated'));

        renderWizard('/admin/dictionary/import/42');

        fireEvent.click(await screen.findByRole('button', { name: '自動建立缺漏主檔' }));

        await waitFor(() => expect(confirmAction).toHaveBeenCalled());
        expect(autoCreateImportTaxonomies).not.toHaveBeenCalled();
    });

    test('非 owner 不顯示自動建立缺漏主檔按鈕', async () => {
        mockRole = 'editor';
        getImportJob.mockResolvedValue(jobForStatus('validated'));

        renderWizard('/admin/dictionary/import/42');

        expect(await screen.findByText('步驟三：預檢報告')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '自動建立缺漏主檔' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '送出審核' })).toBeInTheDocument();
    });

    test('pending_review 的 editor 可撤回但不能核准或退件', async () => {
        mockRole = 'editor';
        getImportJob.mockResolvedValue(jobForStatus('pending_review'));
        withdrawImportJob.mockResolvedValue(jobForStatus('validated'));

        renderWizard('/admin/dictionary/import/42');

        expect(await screen.findByText('審核中')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '撤回' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '核准' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '退件' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '撤回' }));

        await waitFor(() => {
            expect(withdrawImportJob).toHaveBeenCalledWith('42');
        });
    });

    test('pending_review 的 reviewer 可核准或填寫意見後退件', async () => {
        mockRole = 'reviewer';
        getImportJob.mockResolvedValue(jobForStatus('pending_review'));
        approveImportJob.mockResolvedValue(jobForStatus('applied', {
            applied_count: 2, failed_count: 0, report: { ...report, outcomes: [] },
        }));
        rejectImportJob.mockResolvedValue(jobForStatus('rejected', { review_comment: '資料有誤' }));

        renderWizard('/admin/dictionary/import/42');

        await screen.findByText('審核匯入工作');

        expect(screen.queryByRole('button', { name: '撤回' })).not.toBeInTheDocument();

        const rejectButton = screen.getByRole('button', { name: '退件' });
        expect(rejectButton).toBeDisabled();

        fireEvent.change(screen.getByLabelText(/^審核意見$/), { target: { value: '資料有誤' } });
        expect(rejectButton).toBeEnabled();

        fireEvent.click(rejectButton);

        await waitFor(() => {
            expect(rejectImportJob).toHaveBeenCalledWith('42', '資料有誤');
        });
    });

    test('approver 核准時傳入選填的審核意見', async () => {
        mockRole = 'reviewer';
        getImportJob.mockResolvedValue(jobForStatus('pending_review'));
        approveImportJob.mockResolvedValue(jobForStatus('applied', {
            applied_count: 2, failed_count: 0, report: { ...report, outcomes: [] },
        }));

        renderWizard('/admin/dictionary/import/42');
        await screen.findByText('審核匯入工作');

        fireEvent.change(screen.getByLabelText(/^審核意見$/), { target: { value: '內容正確' } });
        fireEvent.click(screen.getByRole('button', { name: '核准' }));

        await waitFor(() => {
            expect(approveImportJob).toHaveBeenCalledWith('42', '內容正確');
        });
    });

    test('稽核 FE7a-09：核准匯入前確認，確認文字帶出新增／更新／錯誤筆數；取消則不呼叫 API', async () => {
        mockRole = 'reviewer';
        confirmAction.mockResolvedValue(false);
        getImportJob.mockResolvedValue(jobForStatus('pending_review', {
            new_count: 12, update_count: 3, error_count: 2,
        }));

        renderWizard('/admin/dictionary/import/42');
        await screen.findByText('審核匯入工作');

        fireEvent.click(screen.getByRole('button', { name: '核准' }));

        await waitFor(() => expect(confirmAction).toHaveBeenCalled());
        const { message } = confirmAction.mock.calls[0][0];
        const { container } = render(message);
        expect(container).toHaveTextContent('新增 12 筆');
        expect(container).toHaveTextContent('更新 3 筆');
        expect(container).toHaveTextContent('2 筆錯誤資料會被略過');
        expect(approveImportJob).not.toHaveBeenCalled();
    });

    test('核准發生 409 時原樣顯示後端訊息', async () => {
        mockRole = 'reviewer';
        getImportJob.mockResolvedValue(jobForStatus('pending_review'));

        const conflict = new Error('資料庫狀態自預檢後已經變化，請重新預檢後再核准');
        conflict.status = 409;
        approveImportJob.mockRejectedValue(conflict);

        renderWizard('/admin/dictionary/import/42');
        await screen.findByText('審核匯入工作');

        fireEvent.click(screen.getByRole('button', { name: '核准' }));

        // 頁面上同時有預檢摘要的 role="alert"（Bootstrap Alert 一律帶這個
        // role），直接用 getByRole('alert') 在這個畫面下有歧義，改成直接
        // 找錯誤訊息本身的文字內容。
        expect(await screen.findByText(conflict.message)).toBeInTheDocument();
    });

    test('applied_with_errors 顯示結果摘要與逐列結果', async () => {
        getImportJob.mockResolvedValue(jobForStatus('applied_with_errors', {
            applied_count: 2,
            failed_count: 1,
            report: {
                ...report,
                outcomes: [
                    {
                        row: 1, name: 'lokah', outcome: 'applied', detail: 'word-100',
                    },
                    {
                        row: 2, name: 'maku', outcome: 'failed', detail: ['資料庫寫入失敗'],
                    },
                    {
                        row: 3, name: 'bad-row', outcome: 'skipped', detail: '預檢錯誤',
                    },
                ],
            },
        }));

        renderWizard('/admin/dictionary/import/42');

        expect(await screen.findByText('已完成')).toBeInTheDocument();
        expect(screen.getByText(/成功套用 2 筆／失敗或略過 1 筆/)).toBeInTheDocument();

        const failedRow = screen.getByText('資料庫寫入失敗').closest('tr');
        const skippedRow = screen.getByText('預檢錯誤').closest('tr');

        expect(within(failedRow).getByText('失敗')).toHaveClass('bg-danger');
        expect(within(skippedRow).getByText('已略過')).toHaveClass('bg-secondary');
    });

    test('rejected 顯示退件原因與原預檢報告', async () => {
        getImportJob.mockResolvedValue(jobForStatus('rejected', { review_comment: '請修正分類名稱' }));

        renderWizard('/admin/dictionary/import/42');

        expect(await screen.findByText('已退件')).toBeInTheDocument();
        expect(screen.getByText(/請修正分類名稱/)).toBeInTheDocument();
        // 稽核 FE7a-14：預檢報告預設只顯示錯誤列，切換「全部」才看到其他列
        expect(screen.getByText('bad-row')).toBeInTheDocument();
        expect(screen.queryByText('lokah')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /全部（3）/ }));
        expect(screen.getByText('lokah')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '送出審核' })).not.toBeInTheDocument();
    });

    test('近期工作使用按鈕角色連結到詳情頁', async () => {
        listImportJobs.mockResolvedValue({
            results: [jobForStatus('validated')], count: 1, page: 1, page_size: 20,
        });

        renderWizard();

        const detailButton = await screen.findByRole('button', { name: '檢視' });
        expect(detailButton).toHaveAttribute('href', '/admin/dictionary/import/42');
    });

    test('選擇族語並匯出 JSON 檔案', async () => {
        const exported = { tribe: 'amis', words: [{ name: 'maku' }] };
        let clickedWhileInDocument = false;
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordClick() {
            clickedWhileInDocument = document.body.contains(this);
        });

        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: vi.fn(() => 'blob:dictionary'),
            revokeObjectURL: vi.fn(),
        });
        exportDictionary.mockResolvedValue(exported);

        renderWizard();
        await screen.findByText('匯出辭典');

        fireEvent.change(screen.getByLabelText(/^族語$/), { target: { value: 'amis' } });
        fireEvent.click(screen.getByRole('button', { name: '匯出' }));

        await waitFor(() => {
            expect(exportDictionary).toHaveBeenCalledWith('amis');
        });

        expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
        expect(click).toHaveBeenCalled();
        // 稽核 FE7a-21：點擊當下 anchor 必須在文件裡，revoke 延後到下載開始之後
        expect(clickedWhileInDocument).toBe(true);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:dictionary');
        }, { timeout: 2000 });
        expect(await screen.findByText('辭典匯出檔已開始下載。')).toBeInTheDocument();

        click.mockRestore();
        vi.unstubAllGlobals();
    });
});
