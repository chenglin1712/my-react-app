import { describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';
import { isEditConflict } from './editConflict';

const fireBeforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event;
};

describe('useUnsavedChangesGuard（稽核 FE7b-03）', () => {
    test('沒有未儲存內容時不攔', () => {
        renderHook(() => useUnsavedChangesGuard(false));
        expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });

    test('有未儲存內容時觸發瀏覽器的離開確認；變回沒有後解除；卸載後解除', () => {
        const { rerender, unmount } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), { initialProps: { dirty: true } });
        expect(fireBeforeUnload().defaultPrevented).toBe(true);

        rerender({ dirty: false });
        expect(fireBeforeUnload().defaultPrevented).toBe(false);

        rerender({ dirty: true });
        unmount();
        expect(fireBeforeUnload().defaultPrevented).toBe(false);
    });
});

describe('isEditConflict（稽核 FE7b-08）', () => {
    test('只認 409 且 code 為 edit_conflict', () => {
        expect(isEditConflict({ status: 409, data: { code: 'edit_conflict' } })).toBe(true);
        expect(isEditConflict({ status: 409, data: { code: 'revision_changed' } })).toBe(false);
        expect(isEditConflict({ status: 409 })).toBe(false);
        expect(isEditConflict({ status: 400, data: { code: 'edit_conflict' } })).toBe(false);
        expect(isEditConflict(null)).toBe(false);
    });
});
