import { describe, test, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useActionLock } from './useActionLock';

describe('useActionLock', () => {
    test('同一個 tick 內重複呼叫 runLocked，只有第一次真正執行', async () => {
        const { result } = renderHook(() => useActionLock());
        let resolveFirst;
        let secondCallRan = false;

        act(() => {
            result.current.runLocked('save', () => new Promise((resolve) => { resolveFirst = resolve; }));
            result.current.runLocked('save', () => {
                secondCallRan = true;
                return Promise.resolve();
            });
        });

        expect(secondCallRan).toBe(false);
        expect(result.current.isLocked).toBe(true);
        expect(result.current.pendingKey).toBe('save');

        await act(async () => {
            resolveFirst();
            await Promise.resolve();
        });

        expect(result.current.isLocked).toBe(false);
        expect(result.current.pendingKey).toBeNull();
    });

    test('不同 key 的操作在鎖定期間也會被擋下（互斥，不是只擋同一個操作）', async () => {
        const { result } = renderHook(() => useActionLock());
        let resolveSave;
        let submitRan = false;

        act(() => {
            result.current.runLocked('save', () => new Promise((resolve) => { resolveSave = resolve; }));
        });
        await act(async () => {
            await result.current.runLocked('submit', () => {
                submitRan = true;
                return Promise.resolve();
            });
        });

        expect(submitRan).toBe(false);

        await act(async () => {
            resolveSave();
            await Promise.resolve();
        });
    });

    test('動作丟出錯誤時仍會釋放鎖，且錯誤會原樣往外拋', async () => {
        const { result } = renderHook(() => useActionLock());

        await expect(act(async () => {
            await result.current.runLocked('save', async () => {
                throw new Error('失敗');
            });
        })).rejects.toThrow('失敗');

        await waitFor(() => {
            expect(result.current.isLocked).toBe(false);
        });

        let ranAfterFailure = false;
        await act(async () => {
            await result.current.runLocked('save', () => {
                ranAfterFailure = true;
                return Promise.resolve();
            });
        });
        expect(ranAfterFailure).toBe(true);
    });
});
