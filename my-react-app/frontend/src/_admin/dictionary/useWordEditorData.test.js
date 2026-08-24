import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useWordEditorData } from './useWordEditorData';
import {
    getRevision,
    getWord,
    getWordReferences,
    listTaxonomies,
    proposeWordDelete,
    submitRevision,
    updateRevisionPayload,
} from './dictionaryApi';

vi.mock('./dictionaryApi', () => ({
    createWordProposal: vi.fn(),
    getRevision: vi.fn(),
    getWord: vi.fn(),
    getWordReferences: vi.fn(),
    listTaxonomies: vi.fn(),
    proposeWordDelete: vi.fn(),
    proposeWordUpdate: vi.fn(),
    updateRevisionPayload: vi.fn(),
    submitRevision: vi.fn(),
    withdrawRevision: vi.fn(),
    approveRevision: vi.fn(),
    rejectRevision: vi.fn(),
    discardRevision: vi.fn(),
}));

const emptyTaxonomies = { tribes: [] };
const emptyWord = { name: '' };
const normalizeWord = (word) => word;
const revisionFromSave = (result, fallback) => ({
    ...fallback,
    ...result,
    id: result?.revision_id ?? result?.id ?? fallback?.id,
    status: result?.status ?? fallback?.status ?? 'draft',
    operation: result?.operation ?? fallback?.operation,
    payload: result?.payload ?? fallback?.payload,
});

function setup(overrides = {}) {
    listTaxonomies.mockResolvedValue(emptyTaxonomies);
    getWordReferences.mockResolvedValue({ counts: {}, sample: [] });

    // reset 一定要在每次 render 都拿到同一個函式參考——放在 renderHook 的
    // callback 裡面每次呼叫 vi.fn() 會產生新的參考，讓依賴它的 useEffect
    // 每次 render 都被判定成「依賴變了」而重新執行，變成無限迴圈。
    const reset = vi.fn();

    return renderHook(() => useWordEditorData({
        id: 'word-1',
        isNew: false,
        prefillName: '',
        reset,
        emptyWord,
        emptyTaxonomies,
        normalizeWord,
        revisionFromSave,
        ...overrides,
    }));
}

describe('useWordEditorData：儲存草稿與送審共用同一把 action lock', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    /** saveDraft（儲存草稿）跟 revisionActions.submit（送審）原本各自有
     * 自己的忙碌旗標，擋得住各自被連點兩下，但擋不住「儲存」跟「送審」
     * 在同一個 tick 內各自被觸發一次——這裡繞過 DOM click 事件的時序，
     * 直接同步呼叫兩個函式，驗證它們真的共用同一把鎖。 */
    test('saveDraft 與 revisionActions.submit 同一個 tick 內都被呼叫時，只有先呼叫的那個真的送出', async () => {
        getWord.mockResolvedValue({
            id: 'word-1',
            content_hash: 'sha256:old',
            meta: { pending_revision: { id: 31, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 31, status: 'draft', operation: 'update', payload: { name: 'abas' },
        });
        updateRevisionPayload.mockResolvedValue({ id: 31, status: 'draft' });
        submitRevision.mockResolvedValue({ id: 31, status: 'pending_review' });

        const { result } = setup();
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.saveDraft(() => ({ name: 'abas' }));
            result.current.revisionActions.submit();
        });

        await waitFor(() => {
            expect(updateRevisionPayload).toHaveBeenCalledTimes(1);
        });
        expect(submitRevision).not.toHaveBeenCalled();
    });

    test('createDeleteProposal 與 revisionActions.submit 同一個 tick 內都被呼叫時，只有先呼叫的那個真的送出', async () => {
        getWord.mockResolvedValue({
            id: 'word-1',
            content_hash: 'sha256:old',
            meta: { pending_revision: { id: 31, status: 'draft', operation: 'update' } },
        });
        getRevision.mockResolvedValue({
            id: 31, status: 'draft', operation: 'update', payload: { name: 'abas' },
        });
        proposeWordDelete.mockResolvedValue({ revision_id: 91, status: 'draft', operation: 'delete' });
        submitRevision.mockResolvedValue({ id: 31, status: 'pending_review' });

        const { result } = setup();
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.deletion.create();
            result.current.revisionActions.submit();
        });

        await waitFor(() => {
            expect(proposeWordDelete).toHaveBeenCalledTimes(1);
        });
        expect(submitRevision).not.toHaveBeenCalled();
    });
});
