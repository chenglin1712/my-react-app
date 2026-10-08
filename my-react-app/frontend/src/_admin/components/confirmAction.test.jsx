import { describe, expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

import { confirmAction } from './confirmAction';

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
});
