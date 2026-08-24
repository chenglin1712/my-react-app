import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useReviewableContentCrud } from './useReviewableContentCrud';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPatch: vi.fn(),
    apiDelete: vi.fn(),
}));

const listPage = (results = []) => ({ results, count: results.length, page: 1, page_size: 20 });

function setup(overrides = {}) {
    return renderHook(() => useReviewableContentCrud({
        endpoint: '/adminapi/things/',
        initialFilters: { status: '' },
        emptyForm: { name: '' },
        formFrom: (item) => ({ name: item.name ?? '' }),
        deleteConfirmMessage: (item) => `刪除 ${item.id}？`,
        ...overrides,
    }));
}

describe('useReviewableContentCrud', () => {
    beforeEach(() => {
        apiGet.mockReset().mockResolvedValue(listPage());
        apiPost.mockReset().mockResolvedValue({});
        apiPatch.mockReset().mockResolvedValue({});
        apiDelete.mockReset().mockResolvedValue({});
    });
    afterEach(() => { vi.restoreAllMocks(); });

    /** 原本 runAction 把錯誤吞掉且沒有回傳值，submitReject 因此不管成功失敗
     * 都會接著 closeReject()——使用者打了一整段退件理由，遇到暫時性錯誤時
     * 對話框直接關掉、理由整段消失。 */
    describe('退件失敗時保留使用者輸入', () => {
        test('退件失敗時對話框不關閉、理由保留', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.reject.open({ id: 1, status: 'pending_review' }); });
            act(() => { result.current.reject.setReason('內容有誤，請修正'); });

            apiPost.mockRejectedValueOnce(new Error('網路掛了'));
            await act(async () => { await result.current.reject.submit(); });

            expect(result.current.reject.target).not.toBeNull();
            expect(result.current.reject.reason).toBe('內容有誤，請修正');
            expect(result.current.error).toBe('網路掛了');
        });

        test('退件成功才關閉對話框並清空理由', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.reject.open({ id: 1, status: 'pending_review' }); });
            act(() => { result.current.reject.setReason('請補上例句'); });

            await act(async () => { await result.current.reject.submit(); });

            expect(result.current.reject.target).toBeNull();
            expect(result.current.reject.reason).toBe('');
            expect(apiPost).toHaveBeenCalledWith('/adminapi/things/1/reject/', {
                review_comment: '請補上例句',
            });
        });

        test('退件修改失敗時同樣保留對話框與 isRevision 模式', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.reject.open({ id: 7, status: 'published' }, true); });
            act(() => { result.current.reject.setReason('修改內容不妥'); });

            apiPost.mockRejectedValueOnce(new Error('伺服器錯誤'));
            await act(async () => { await result.current.reject.submit(); });

            expect(result.current.reject.target).not.toBeNull();
            expect(result.current.reject.isRevision).toBe(true);
            expect(result.current.reject.reason).toBe('修改內容不妥');
        });

        test('理由是空白時不送出', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.reject.open({ id: 1, status: 'pending_review' }); });
            act(() => { result.current.reject.setReason('   '); });

            await act(async () => { await result.current.reject.submit(); });
            expect(apiPost).not.toHaveBeenCalled();
        });
    });

    describe('動作對應到正確的端點', () => {
        test('核准帶空的 review_comment，下架不帶 body', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.handleAction('approve', { id: 3 }); });
            expect(apiPost).toHaveBeenCalledWith('/adminapi/things/3/approve/', { review_comment: '' });

            apiPost.mockClear();
            await act(async () => { await result.current.handleAction('unpublish', { id: 3 }); });
            expect(apiPost).toHaveBeenCalledWith('/adminapi/things/3/unpublish/', undefined);
        });

        test('核准修改用 pending-revision/approve 且同樣帶 review_comment', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.handleAction('approveRevision', { id: 5 }); });
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/things/5/pending-revision/approve/', { review_comment: '' },
            );
        });

        test('刪除時按取消不會呼叫 API', async () => {
            vi.spyOn(window, 'confirm').mockReturnValue(false);
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            let outcome;
            await act(async () => { outcome = await result.current.runAction({ id: 9 }, 'delete'); });

            expect(apiDelete).not.toHaveBeenCalled();
            expect(outcome).toBe(false);
        });
    });

    /** 原本 actionId 只是 state：擋不住同一個 tick 連點兩次，也擋不住不同列
     * 的操作互相干擾（A 列先結束會把 B 列還在跑的 actionId 一起清掉，畫面
     * 顯示「沒有任何操作在跑」但 B 其實還沒做完）。 */
    describe('回歸測試：同一時間只能有一個動作在跑', () => {
        test('同一個 tick 連點兩次同一個操作，只會真的送出一次 API', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            let resolveFirst;
            apiPost.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));

            let firstPromise, secondPromise;
            act(() => {
                firstPromise = result.current.runAction({ id: 1 }, 'approve');
                secondPromise = result.current.runAction({ id: 1 }, 'approve');
            });

            expect(apiPost).toHaveBeenCalledTimes(1);
            await expect(secondPromise).resolves.toBe(false);

            await act(async () => {
                resolveFirst({});
                await Promise.resolve();
            });
            await expect(firstPromise).resolves.toBe(true);
        });

        test('不同列的操作也會被同一個鎖擋住，不會互相干擾 actionId', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            let resolveFirst;
            apiPost.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));

            let secondPromise;
            act(() => {
                result.current.runAction({ id: 1 }, 'approve');
                secondPromise = result.current.runAction({ id: 2 }, 'approve');
            });

            expect(result.current.actionId).toBe(1);
            await expect(secondPromise).resolves.toBe(false);
            // 第一個操作還沒結束，actionId 不該被第二個（被擋下的）操作清掉
            expect(result.current.actionId).toBe(1);

            await act(async () => {
                resolveFirst({});
                await Promise.resolve();
            });
            expect(result.current.actionId).toBeNull();
        });
    });

    describe('回歸測試：openEdit 的過期回應保護', () => {
        test('快速點開 A 列再點開 B 列，畫面顯示 B 列的編輯表單，不會被較慢的 A 回應蓋掉', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            let resolveA;
            apiGet.mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
            apiGet.mockResolvedValueOnce({ payload: { name: 'B內容' } });

            act(() => { result.current.editor.openEdit({ id: 'A', status: 'published', name: 'A原始' }); });
            await act(async () => {
                await result.current.editor.openEdit({ id: 'B', status: 'published', name: 'B原始' });
            });

            expect(result.current.editor.target).toEqual({ id: 'B', status: 'published', name: 'B原始' });
            expect(result.current.editor.form).toEqual({ name: 'B內容' });

            // A 的查詢這時候才回來，不該蓋掉 B 已經顯示的編輯表單
            await act(async () => {
                resolveA({ payload: { name: 'A內容' } });
                await Promise.resolve();
            });
            expect(result.current.editor.target).toEqual({ id: 'B', status: 'published', name: 'B原始' });
            expect(result.current.editor.form).toEqual({ name: 'B內容' });
        });
    });
});
