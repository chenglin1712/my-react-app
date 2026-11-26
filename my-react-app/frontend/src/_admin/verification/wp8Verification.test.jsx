import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    act, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import VerificationQueue from './VerificationQueue';
import { apiGet, apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: 'owner' }, loading: false }),
}));

const row = {
    id: 1,
    tribe: 'kavalan',
    kind: 'unmatched_form',
    form: 'form1',
    proposal: null,
    occurrence_count: 1,
    sentence_count: 1,
    review_state: 'awaiting_expert_review',
    opinion_count: 0,
    my_review: null,
};

const itemCalls = () => apiGet.mock.calls.filter(([url]) => /verification\/items\/\?/.test(url));

describe('VerificationQueue（WP-8）', () => {
    beforeEach(() => {
        apiGet.mockReset();
        apiPost.mockReset();
        apiGet.mockImplementation(async (url) => {
            if (url.startsWith('/adminapi/verification/status/')) return { enabled: true };
            if (/items\/\d+\//.test(url)) return { reviews: [] };
            return { results: [row], count: 1, page: 1, page_size: 25 };
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('稽核 FE7b-11：搜尋框停手 300ms 才發一次查詢', async () => {
        render(<VerificationQueue />);
        await screen.findByText('form1');
        const before = itemCalls().length;

        vi.useFakeTimers();
        const input = screen.getByLabelText('搜尋詞形');
        fireEvent.change(input, { target: { value: 'a' } });
        fireEvent.change(input, { target: { value: 'ab' } });
        fireEvent.change(input, { target: { value: 'abc' } });
        expect(itemCalls().length).toBe(before);

        await act(async () => { vi.advanceTimersByTime(350); });
        vi.useRealTimers();

        await waitFor(() => expect(itemCalls().length).toBe(before + 1));
        expect(new URLSearchParams(itemCalls().at(-1)[0].split('?')[1]).get('q')).toBe('abc');
    });

    test('稽核 FE7b-12：意見單選有 fieldset／legend，送出中不可取消也不可重複送出', async () => {
        let resolvePost;
        apiPost.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));

        render(<VerificationQueue />);
        await screen.findByText('form1');
        fireEvent.click(screen.getByRole('button', { name: '提供意見' }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('group', { name: '你的意見' })).toBeInTheDocument();

        fireEvent.click(within(dialog).getByLabelText('同意'));
        const submit = within(dialog).getByRole('button', { name: '送出意見' });
        fireEvent.click(submit);
        fireEvent.click(submit);

        await waitFor(() => expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled());
        expect(apiPost).toHaveBeenCalledTimes(1);

        await act(async () => { resolvePost({ item: { ...row, my_review: { verdict: 'agree' } } }); });
    });
});
