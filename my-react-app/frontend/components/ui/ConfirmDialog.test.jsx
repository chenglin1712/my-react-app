import { describe, expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { confirmAction } from './ConfirmDialog';

const open = (options) => {
    let promise;
    act(() => { promise = confirmAction(options); });
    return promise;
};

describe('confirmAction（站內確認視窗）', () => {
    test('按確認回傳 true，並把視窗收掉', async () => {
        const result = open({ title: '刪除公告', message: '確定要刪除嗎？', confirmLabel: '刪除公告' });
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText('確定要刪除嗎？')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: '刪除公告' }));
        await expect(result).resolves.toBe(true);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    test('按取消回傳 false', async () => {
        const result = open({ title: '刪除', message: '確定？' });
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
        await expect(result).resolves.toBe(false);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    test('按右上角關閉也算取消', async () => {
        const result = open({ title: '刪除', message: '確定？' });
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: /close/i }));
        await expect(result).resolves.toBe(false);
    });

    test('requireText：輸入符合的文字之前，確認按鈕是停用的', async () => {
        const result = open({ title: '刪除', message: '確定？', confirmLabel: '刪除', requireText: '刪除' });
        const dialog = await screen.findByRole('dialog');
        const confirm = within(dialog).getByRole('button', { name: '刪除' });
        expect(confirm).toBeDisabled();

        fireEvent.change(within(dialog).getByLabelText(/請輸入「刪除」以確認/), { target: { value: '刪' } });
        expect(confirm).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText(/請輸入「刪除」以確認/), { target: { value: '刪除' } });
        expect(confirm).not.toBeDisabled();
        fireEvent.click(confirm);
        await expect(result).resolves.toBe(true);
    });

    test('已有一個確認視窗時再呼叫，直接回傳 false，不會疊出第二個視窗', async () => {
        const first = open({ title: '交卷', message: '確定？', confirmLabel: '送出' });
        await screen.findByRole('dialog');
        const second = open({ title: '交卷', message: '確定？', confirmLabel: '送出' });
        await expect(second).resolves.toBe(false);
        expect(screen.getAllByRole('dialog')).toHaveLength(1);

        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '送出' }));
        await expect(first).resolves.toBe(true);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        // 關掉之後可以再開
        const third = open({ title: '再開', message: '確定？' });
        await screen.findByRole('dialog');
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
        await expect(third).resolves.toBe(false);
    });
});
