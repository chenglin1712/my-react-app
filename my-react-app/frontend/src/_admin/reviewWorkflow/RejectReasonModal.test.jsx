import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import RejectReasonModal from './RejectReasonModal';

/** 回歸測試：送出中途不能被關掉——不然使用者按了確認、退件理由送出中途
 * 手滑點到背景／按 Escape／點右上角關閉，會直接把對話框收掉，
 * useReviewableContentCrud 那層特意保留的失敗理由文字也就沒有意義了
 * （表單已經被收掉，使用者看不到）。 */

function renderModal(overrides = {}) {
    const reject = {
        target: { id: 1 },
        reason: '內容有誤',
        setReason: vi.fn(),
        isRevision: false,
        close: vi.fn(),
        submit: vi.fn(),
        ...overrides,
    };
    return {
        reject,
        ...render(<RejectReasonModal reject={reject} actionId={null} controlId="reject-reason" />),
    };
}

describe('RejectReasonModal', () => {
    test('沒有在送出時，取消按鈕會呼叫 close', async () => {
        const user = userEvent.setup();
        const { reject } = renderModal();

        await user.click(screen.getByRole('button', { name: '取消' }));
        expect(reject.close).toHaveBeenCalled();
    });

    test('回歸測試：送出中（actionId 等於 target.id）時，取消按鈕被 disabled、點擊不會呼叫 close', async () => {
        const reject = {
            target: { id: 1 },
            reason: '內容有誤',
            setReason: vi.fn(),
            isRevision: false,
            close: vi.fn(),
            submit: vi.fn(),
        };
        render(<RejectReasonModal reject={reject} actionId={1} controlId="reject-reason" />);

        const cancelButton = screen.getByRole('button', { name: '取消' });
        expect(cancelButton).toBeDisabled();

        fireEvent.click(cancelButton);
        expect(reject.close).not.toHaveBeenCalled();
    });

    test('送出中時確認按鈕顯示「送出中…」且被 disabled', () => {
        const reject = { target: { id: 1 }, reason: '內容有誤', setReason: vi.fn(), isRevision: false, close: vi.fn(), submit: vi.fn() };
        render(<RejectReasonModal reject={reject} actionId={1} controlId="reject-reason-2" />);

        const submitButton = screen.getByRole('button', { name: '送出中…' });
        expect(submitButton).toBeDisabled();
    });
});
