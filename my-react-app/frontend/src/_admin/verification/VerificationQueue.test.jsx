import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import VerificationQueue from './VerificationQueue';
import stateLabel from './stateLabel';
import { apiGet, apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const item = (id, overrides = {}) => ({
    id,
    key: String(id).padStart(64, '0'),
    tribe: 'kavalan',
    kind: 'unmatched_form',
    form: `form${id}`,
    proposal: null,
    occurrence_count: 12,
    sentence_count: 8,
    observation_count: 1,
    review_state: 'awaiting_expert_review',
    opinion_count: 0,
    agree_count: 0,
    disagree_count: 0,
    uncertain_count: 0,
    has_conflicting_opinions: false,
    my_review: null,
    ...overrides,
});

const listing = (results, extra = {}) => ({
    results, count: results.length, page: 1, page_size: 25, notice: '此佇列只收集意見', ...extra,
});

function route(handlers = {}) {
    apiGet.mockImplementation(async (url) => {
        if (url.startsWith('/adminapi/verification/status/')) return handlers.status ?? { enabled: true };
        if (url.startsWith('/adminapi/verification/items/') && /items\/\d+\//.test(url)) return handlers.detail ?? { reviews: [] };
        if (url.startsWith('/adminapi/verification/items/')) return handlers.items ?? listing([item(1), item(2)]);
        if (url.startsWith('/adminapi/verification/export/')) return handlers.export ?? 'item_key,tribe\r\n';
        throw new Error(`unexpected ${url}`);
    });
}

describe('stateLabel', () => {
    test('每個狀態的主標都是待專家驗證，沒有任何已驗證', () => {
        const states = [
            stateLabel(item(1)),
            stateLabel(item(1, { review_state: 'opinions_recorded', opinion_count: 2 })),
            stateLabel(item(1, { review_state: 'conflicting_opinions', opinion_count: 3 })),
        ];
        states.forEach((s) => {
            expect(s.text.startsWith('待專家驗證')).toBe(true);
            expect(s.text).not.toMatch(/已驗證|verified/i);
        });
        expect(states[1].text).toContain('2 則意見');
        expect(states[2].text).toContain('意見不一致');
    });
});

describe('VerificationQueue', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
        apiPost.mockReset();
    });
    afterEach(() => vi.restoreAllMocks());

    test('旗標關閉時只顯示未啟用，不載入任何項目', async () => {
        route({ status: { enabled: false } });
        render(<VerificationQueue />);
        expect(await screen.findByText(/尚未啟用/)).toBeInTheDocument();
        expect(apiGet).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('匯出待填 CSV')).not.toBeInTheDocument();
    });

    test('沒有後台角色：顯示無權限且不呼叫 API', () => {
        mockRole = 'learner';
        route();
        render(<VerificationQueue />);
        expect(screen.getByText(/沒有權限檢視/)).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });

    test('顯示清單與三種狀態，整頁沒有「已驗證」字樣', async () => {
        route({
            items: listing([
                item(1),
                item(2, { review_state: 'opinions_recorded', opinion_count: 2 }),
                item(3, { review_state: 'conflicting_opinions', opinion_count: 3, has_conflicting_opinions: true }),
                item(4, {
                    kind: 'morph_analysis', tribe: 'amis', form: 'maala',
                    proposal: { predicted_root: 'ala', rule: 'ma-', gold_roots: ['mala'] },
                }),
            ]),
        });
        const { container } = render(<VerificationQueue />);
        expect(await screen.findByText('form1')).toBeInTheDocument();
        expect(screen.getByText('待專家驗證・已有 2 則意見')).toBeInTheDocument();
        expect(screen.getByText('待專家驗證・意見不一致（3 則）')).toBeInTheDocument();
        expect(screen.getAllByText('待專家驗證').length).toBeGreaterThan(0);
        expect(within(screen.getByRole('table')).getByText('阿美語')).toBeInTheDocument();
        expect(screen.getByText('mala', { exact: false })).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/已驗證|verified|validated/i);
        expect(container.textContent).toContain('不會寫回辭典或測驗題庫');
    });

    test.each([
        ['owner', { review: true, exportCsv: true, importer: true }],
        ['admin', { review: true, exportCsv: true, importer: true }],
        ['reviewer', { review: true, exportCsv: true, importer: false }],
        ['analyst', { review: false, exportCsv: true, importer: false }],
        ['editor', { review: false, exportCsv: false, importer: false }],
    ])('%s 看得到的操作與角色矩陣一致', async (role, expected) => {
        mockRole = role;
        route();
        render(<VerificationQueue />);
        expect(await screen.findByText('form1')).toBeInTheDocument();
        expect(Boolean(screen.queryAllByRole('button', { name: '提供意見' }).length)).toBe(expected.review);
        expect(Boolean(screen.queryByRole('button', { name: /匯出待填 CSV/ }))).toBe(expected.exportCsv);
        expect(Boolean(screen.queryByText('匯入意見（CSV）'))).toBe(expected.importer);
    });

    test('提交意見：必須先選意見，送出的內容正確，列會更新，並說明不會寫回', async () => {
        route();
        apiPost.mockResolvedValue({
            outcome: 'created',
            item: item(1, { review_state: 'opinions_recorded', opinion_count: 1, my_review: { verdict: 'disagree', correction: 'forma', dialect: '', notes: '' } }),
        });
        render(<VerificationQueue />);
        fireEvent.click((await screen.findAllByRole('button', { name: '提供意見' }))[0]);
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/不會改動辭典或測驗題庫/)).toBeInTheDocument();
        const submit = within(dialog).getByRole('button', { name: /送出意見/ });
        expect(submit).toBeDisabled();
        fireEvent.click(within(dialog).getByLabelText('不同意'));
        fireEvent.change(within(dialog).getByLabelText(/建議的正確寫法/), { target: { value: 'forma' } });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/adminapi/verification/items/1/review/', {
            verdict: 'disagree', correction: 'forma', dialect: '', notes: '',
        }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByText('待專家驗證・已有 1 則意見')).toBeInTheDocument();
        expect(screen.getByText('你的意見：不同意')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '修改我的意見' })).toBeInTheDocument();
    });

    test('提交失敗時顯示錯誤並保留對話框', async () => {
        route();
        apiPost.mockRejectedValue(new Error('correction 超過 200 字'));
        render(<VerificationQueue />);
        fireEvent.click((await screen.findAllByRole('button', { name: '提供意見' }))[0]);
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByLabelText('同意'));
        fireEvent.click(within(dialog).getByRole('button', { name: /送出意見/ }));
        expect(await within(dialog).findByText('correction 超過 200 字')).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    test('對話框顯示既有意見（審核者角色）', async () => {
        route({ detail: { reviews: [{ reviewer_type: 'external', reviewer_label: '王老師', verdict: 'agree', correction: '', dialect: '', notes: '' }] } });
        render(<VerificationQueue />);
        fireEvent.click((await screen.findAllByRole('button', { name: '提供意見' }))[0]);
        expect(await screen.findByText(/王老師/)).toBeInTheDocument();
        expect(screen.getByText(/外部審核者/)).toBeInTheDocument();
    });

    test('篩選與換頁會帶參數重新載入，換篩選回到第一頁', async () => {
        route({ items: listing([item(1)], { count: 60, page_size: 25 }) });
        render(<VerificationQueue />);
        await screen.findByText('form1');
        fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
        await waitFor(() => expect(apiGet.mock.calls.some(([u]) => u.includes('page=2'))).toBe(true));
        fireEvent.change(screen.getByLabelText('族語'), { target: { value: 'tayal' } });
        await waitFor(() => {
            const last = apiGet.mock.calls.filter(([u]) => u.startsWith('/adminapi/verification/items/?')).at(-1)[0];
            expect(last).toContain('tribe=tayal');
            expect(last).toContain('page=1');
        });
        fireEvent.change(screen.getByLabelText('狀態'), { target: { value: 'conflicting_opinions' } });
        await waitFor(() => expect(apiGet.mock.calls.some(([u]) => u.includes('state=conflicting_opinions'))).toBe(true));
    });

    test('載入失敗時清掉舊清單並顯示錯誤', async () => {
        let fail = false;
        apiGet.mockImplementation(async (url) => {
            if (url.startsWith('/adminapi/verification/status/')) return { enabled: true };
            if (fail) throw new Error('沒有權限執行此操作');
            return listing([item(1)]);
        });
        render(<VerificationQueue />);
        await screen.findByText('form1');
        fail = true;
        fireEvent.change(screen.getByLabelText('種類'), { target: { value: 'morph_analysis' } });
        expect(await screen.findByText('沒有權限執行此操作')).toBeInTheDocument();
        expect(screen.queryByText('form1')).not.toBeInTheDocument();
    });

    test('匯出：下載固定檔名的 CSV（開頭補 BOM）', async () => {
        route({ export: 'item_key,tribe\r\nabc,kavalan\r\n' });
        const create = vi.fn(() => 'blob:x');
        const revoke = vi.fn();
        Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true, writable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true, writable: true });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(<VerificationQueue />);
        await screen.findByText('form1');
        fireEvent.click(screen.getByRole('button', { name: /匯出待填 CSV/ }));
        await waitFor(() => expect(click).toHaveBeenCalled());
        const blob = create.mock.calls[0][0];
        const bytes = new Uint8Array(await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsArrayBuffer(blob); }));
        expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);          // 開頭恰好一個 UTF-8 BOM
        expect(new TextDecoder().decode(bytes.slice(3))).toBe('item_key,tribe\r\nabc,kavalan\r\n');
        expect(revoke).toHaveBeenCalledWith('blob:x');
    });

    test('匯出：後端內容已含 BOM 時不重複添加；回傳不是文字時顯示錯誤', async () => {
        route({ export: '\uFEFFitem_key\r\n' });
        const create = vi.fn(() => 'blob:y');
        Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true, writable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(<VerificationQueue />);
        await screen.findByText('form1');
        fireEvent.click(screen.getByRole('button', { name: /匯出待填 CSV/ }));
        await waitFor(() => expect(create).toHaveBeenCalled());
        const bytes = new Uint8Array(await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsArrayBuffer(create.mock.calls[0][0]); }));
        expect(Array.from(bytes.slice(0, 6))).toEqual([0xef, 0xbb, 0xbf, 0x69, 0x74, 0x65]);   // BOM 之後直接是 "ite"，沒有第二個 BOM
        route({ export: { not: 'text' } });
        fireEvent.click(screen.getByRole('button', { name: /匯出待填 CSV/ }));
        expect(await screen.findByText('匯出內容格式不符')).toBeInTheDocument();
    });

    test('對話框載入既有意見失敗時顯示警告，不偽裝成沒有意見', async () => {
        apiGet.mockImplementation(async (url) => {
            if (url.startsWith('/adminapi/verification/status/')) return { enabled: true };
            if (/items\/\d+\//.test(url)) throw new Error('沒有權限執行此操作');
            return listing([item(1)]);
        });
        render(<VerificationQueue />);
        fireEvent.click((await screen.findAllByRole('button', { name: '提供意見' }))[0]);
        expect(await screen.findByText(/無法載入既有意見（沒有權限執行此操作）/)).toBeInTheDocument();
    });

    test('換檔期間不能用舊檔內容預覽；先選的檔案晚讀完也不會蓋掉後選的', async () => {
        route();
        apiPost.mockResolvedValue({
            dry_run: true, applied: false, rows_total: 1, rows_valid: 1, rows_skipped_blank: 0, error_count: 0, errors: [],
            created: 1, updated: 0, unchanged: 0,
        });
        const { container } = render(<VerificationQueue />);
        await screen.findByText('form1');
        let releaseA;
        const fileA = new File(['a'], 'a.csv');
        fileA.text = () => new Promise((resolve) => { releaseA = () => resolve('CONTENT-A'); });
        const fileB = new File(['b'], 'b.csv');
        fileB.text = async () => 'CONTENT-B';
        const input = container.querySelector('input[type="file"]');
        fireEvent.change(input, { target: { files: [fileA] } });
        expect(screen.getByRole('button', { name: /預覽/ })).toBeDisabled();            // A 還沒讀完
        fireEvent.change(input, { target: { files: [fileB] } });
        await waitFor(() => expect(screen.getByRole('button', { name: /預覽（b.csv）/ })).toBeEnabled());
        releaseA();                                                                      // A 晚到
        await Promise.resolve();
        fireEvent.click(screen.getByRole('button', { name: /預覽/ }));
        await waitFor(() => expect(apiPost).toHaveBeenCalled());
        expect(apiPost.mock.calls[0][1]).toEqual({ csv: 'CONTENT-B', dry_run: true });
        expect(screen.queryByRole('button', { name: /預覽（a.csv）/ })).not.toBeInTheDocument();
    });

    test('檔案選擇有可讀的標籤', async () => {
        route();
        render(<VerificationQueue />);
        await screen.findByText('form1');
        expect(screen.getByLabelText('選擇要匯入的 CSV 檔')).toBeInTheDocument();
    });

    test('匯入：先預覽、再確認，才寫入；寫入後重新載入清單', async () => {
        route();
        apiPost
            .mockResolvedValueOnce({
                dry_run: true, applied: false, rows_total: 2, rows_valid: 2, rows_skipped_blank: 0, error_count: 0, errors: [],
                created: 2, updated: 0, unchanged: 0,
            })
            .mockResolvedValueOnce({ dry_run: false, applied: true, created: 2, updated: 0, unchanged: 0 });
        const { container } = render(<VerificationQueue />);
        await screen.findByText('form1');
        const file = new File(['item_key,verdict,reviewer\r\n'], 'r.csv', { type: 'text/csv' });
        file.text = async () => 'item_key,verdict,reviewer\r\nx,agree,A\r\n';
        fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
        const confirm = screen.getByRole('button', { name: '確認匯入' });
        expect(confirm).toBeDisabled();
        fireEvent.click(await screen.findByRole('button', { name: /預覽/ }));
        expect(await screen.findByText(/預覽：新增 2、更新 0、沒有變動 0/)).toBeInTheDocument();
        expect(apiPost).toHaveBeenLastCalledWith('/adminapi/verification/import/', { csv: 'item_key,verdict,reviewer\r\nx,agree,A\r\n', dry_run: true });
        const before = apiGet.mock.calls.length;
        fireEvent.click(screen.getByRole('button', { name: '確認匯入' }));
        expect(await screen.findByText(/已匯入：新增 2/)).toBeInTheDocument();
        expect(screen.getByText(/仍待專家驗證/, { selector: '.alert *, .alert' })).toBeInTheDocument();
        expect(apiPost).toHaveBeenLastCalledWith('/adminapi/verification/import/', { csv: 'item_key,verdict,reviewer\r\nx,agree,A\r\n', dry_run: false });
        await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(before));
    });

    test('匯入有錯誤時列出每一個錯誤、不允許確認匯入', async () => {
        route();
        const err = new Error('x');
        err.data = {
            rows_total: 3, rows_valid: 1, rows_skipped_blank: 0, error_count: 2,
            errors: [{ line: 2, message: 'verdict 必須是 agree、disagree 或 uncertain' }, { line: 4, message: '找不到這個 item_key 的項目' }],
        };
        apiPost.mockRejectedValue(err);
        const { container } = render(<VerificationQueue />);
        await screen.findByText('form1');
        const file = new File(['x'], 'r.csv');
        file.text = async () => 'x';
        fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
        fireEvent.click(await screen.findByRole('button', { name: /預覽/ }));
        expect(await screen.findByText(/第 2 列：verdict 必須是/)).toBeInTheDocument();
        expect(screen.getByText(/第 4 列：找不到這個 item_key/)).toBeInTheDocument();
        expect(screen.getByText('檔案有錯誤，沒有寫入任何資料。')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '確認匯入' })).toBeDisabled();
    });
});
