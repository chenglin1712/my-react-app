import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useReviewableContentCrud } from './useReviewableContentCrud';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import { confirmAction } from '@components/ui/ConfirmDialog';

vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: vi.fn() }));

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

        test('核准修改用 pending-revision/approve，帶 review_comment 與審核者看到的版本', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.handleAction('approveRevision', { id: 5, pending_revision_version: 'v-list' });
            });
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/things/5/pending-revision/approve/', { review_comment: '', revision_version: 'v-list' },
            );
        });

        test('沒有版本值時不送出核准修改，並提示重新載入（稽核 FLW-1）', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.handleAction('approveRevision', { id: 5 }); });
            expect(apiPost).not.toHaveBeenCalled();
            expect(result.current.error).toContain('重新載入');
        });

        test('審核者打開過編輯視窗，核准用那時看到的版本而不是列表上的版本', async () => {
            apiGet.mockImplementation(async (url) => {
                if (url === '/adminapi/things/5/pending-revision/') return { payload: { name: '新' }, version: 'v-viewed' };
                return listPage();
            });
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));
            const item = { id: 5, status: 'published', name: '舊', pending_revision_version: 'v-list' };

            await act(async () => { await result.current.editor.openEdit(item); });
            await act(async () => { await result.current.handleAction('approveRevision', item); });

            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/things/5/pending-revision/approve/', { review_comment: '', revision_version: 'v-viewed' },
            );
        });

        test('退件修改帶版本；沒有版本時不送出', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.reject.open({ id: 5, pending_revision_version: 'v-list' }, true); });
            act(() => { result.current.reject.setReason('不同意'); });
            await act(async () => { await result.current.reject.submit(); });
            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/things/5/pending-revision/reject/', { review_comment: '不同意', revision_version: 'v-list' },
            );

            apiPost.mockClear();
            act(() => { result.current.reject.open({ id: 6 }, true); });
            act(() => { result.current.reject.setReason('不同意'); });
            await act(async () => { await result.current.reject.submit(); });
            expect(apiPost).not.toHaveBeenCalled();
            expect(result.current.error).toContain('重新載入');
        });

        test('一般退件（非修改）不帶版本', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.reject.open({ id: 7, status: 'pending_review' }); });
            act(() => { result.current.reject.setReason('請修正'); });
            await act(async () => { await result.current.reject.submit(); });
            expect(apiPost).toHaveBeenCalledWith('/adminapi/things/7/reject/', { review_comment: '請修正' });
        });

        test('後端回 revision_changed（409）時重新載入列表並顯示錯誤，不套用', async () => {
            apiPost.mockRejectedValueOnce(Object.assign(new Error('這筆待審修改在你檢視之後被更新了'), {
                status: 409, data: { code: 'revision_changed' },
            }));
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));
            const listCalls = apiGet.mock.calls.length;

            let ok;
            await act(async () => {
                ok = await result.current.handleAction('approveRevision', { id: 5, pending_revision_version: 'v-old' });
            });
            expect(ok).toBe(false);
            expect(apiGet.mock.calls.length).toBeGreaterThan(listCalls);
            expect(result.current.error).toContain('被更新');
        });

        test('刪除時按取消不會呼叫 API', async () => {
            confirmAction.mockResolvedValueOnce(false);
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

    /** F8：已經有待審修改時重送會原地覆蓋它。後端要求帶「打開編輯表單時看到的版本」，
     * 別人在這段時間送出或改過就回 409，不會無聲蓋掉。 */
    describe('重送待審修改要帶打開時看到的版本（F8）', () => {
        const publishedItem = { id: 5, status: 'published', name: '舊' };
        const revisionUrl = '/adminapi/things/5/pending-revision/';

        const openAndSave = async (result, item = publishedItem) => {
            await act(async () => { await result.current.editor.openEdit(item); });
            await act(async () => { await result.current.editor.save(undefined, { name: '新內容' }); });
        };

        test('打開時已有待審修改：送出帶 base_version', async () => {
            apiGet.mockImplementation(async (url) => (url === revisionUrl ? { payload: { name: '提案' }, version: 'v-open' } : listPage()));
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await openAndSave(result);

            expect(apiPost).toHaveBeenCalledWith(revisionUrl, { name: '新內容', base_version: 'v-open' });
        });

        test('打開時沒有待審修改（404）：不帶 base_version', async () => {
            apiGet.mockImplementation(async (url) => {
                if (url === revisionUrl) throw Object.assign(new Error('沒有'), { status: 404 });
                return listPage();
            });
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await openAndSave(result);

            expect(apiPost).toHaveBeenCalledWith(revisionUrl, { name: '新內容' });
        });

        test('先前開過別次、留著舊版本：這次打開是 404 就不能沿用舊版本', async () => {
            let hasPending = true;
            apiGet.mockImplementation(async (url) => {
                if (url !== revisionUrl) return listPage();
                if (hasPending) return { payload: { name: '提案' }, version: 'v-old' };
                throw Object.assign(new Error('沒有'), { status: 404 });
            });
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.editor.openEdit(publishedItem); });
            hasPending = false;
            await openAndSave(result);

            expect(apiPost).toHaveBeenCalledWith(revisionUrl, { name: '新內容' });
        });

        test('送出成功後記下回應裡的新版本，之後核准帶的是新版本而不是舊的', async () => {
            apiGet.mockImplementation(async (url) => (url === revisionUrl ? { payload: { name: '提案' }, version: 'v-open' } : listPage()));
            apiPost.mockResolvedValueOnce({ id: 9, version: 'v-after-save' });
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await openAndSave(result);
            apiPost.mockClear();
            await act(async () => { await result.current.handleAction('approveRevision', { ...publishedItem, pending_revision_version: 'v-list' }); });

            expect(apiPost).toHaveBeenCalledWith(
                '/adminapi/things/5/pending-revision/approve/', { review_comment: '', revision_version: 'v-after-save' },
            );
        });

        test('後端回 409（別人先改過）：顯示後端說明、編輯視窗保持開著、不關閉也不重新載入', async () => {
            apiGet.mockImplementation(async (url) => (url === revisionUrl ? { payload: { name: '提案' }, version: 'v-open' } : listPage()));
            apiPost.mockRejectedValueOnce(Object.assign(new Error('這筆內容已有待審修改，請重新載入'), { status: 409 }));
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));
            const listCalls = () => apiGet.mock.calls.filter(([url]) => url !== revisionUrl).length;
            const before = listCalls();

            await openAndSave(result);

            expect(result.current.error).toBe('這筆內容已有待審修改，請重新載入');
            expect(result.current.editor.target).not.toBeNull();
            expect(listCalls()).toBe(before);
        });

        test('存過之後別人核准又建了新提案：第一次核准被擋（revision_changed）後丟掉快取版本，第二次改用列表上的新版本', async () => {
            apiGet.mockImplementation(async (url) => (url === revisionUrl ? { payload: { name: '提案' }, version: 'v-open' } : listPage()));
            apiPost.mockResolvedValueOnce({ id: 9, version: 'v-after-save' });
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));
            await openAndSave(result);
            apiPost.mockClear();
            apiPost.mockRejectedValueOnce(Object.assign(new Error('這筆待審修改在你檢視之後被更新了'), {
                status: 409, data: { code: 'revision_changed' },
            }));
            apiPost.mockResolvedValueOnce({});
            const rowNow = { ...publishedItem, pending_revision_version: 'v-new-proposal' };

            await act(async () => { await result.current.handleAction('approveRevision', rowNow); });
            await act(async () => { await result.current.handleAction('approveRevision', rowNow); });

            expect(apiPost.mock.calls[0][1]).toEqual({ review_comment: '', revision_version: 'v-after-save' });
            expect(apiPost.mock.calls[1][1]).toEqual({ review_comment: '', revision_version: 'v-new-proposal' });
        });

        test('草稿等不走待審修改的狀態：照舊用 PATCH，不帶 base_version', async () => {
            const { result } = setup();
            await waitFor(() => expect(result.current.loading).toBe(false));

            await openAndSave(result, { id: 5, status: 'draft', name: '草稿' });

            expect(apiPatch).toHaveBeenCalledWith('/adminapi/things/5/', { name: '新內容' });
            expect(apiPost).not.toHaveBeenCalled();
        });
    });
});
