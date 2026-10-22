import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AiFeedback from './AiFeedback';
import { apiGet, apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

let mockRole = 'admin';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const item = (extra = {}) => ({
    id: 1, createdAt: '2026-10-21T08:00:00Z', rating: 'down', reason: 'too_long', comment: '太囉嗦',
    question: 'lokah 是什麼意思？', reply: '很長的回答', tribe: 'tayal', model: 'claude-sonnet-5-5',
    promptVersion: 'deadbeef', requestId: 'req_1', user: 'ab12cd34', evalCandidate: false, evalNote: '', ...extra,
});
const page = (items, extra = {}) => ({
    summary: { total: 3, up: 1, down: 2, byReason: { too_long: 1, wrong_tribal: 1 }, candidates: 0 },
    items, page: 1, pages: 1, pageSize: 20, count: items.length, ...extra,
});

describe('AiFeedback admin page', () => {
    beforeEach(() => { apiGet.mockReset(); apiPost.mockReset(); mockRole = 'admin'; });

    test('roles other than owner/admin see a denial and never call the API', async () => {
        mockRole = 'editor';
        render(<AiFeedback />);
        expect(await screen.findByText(/只有擁有者與管理員/)).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });

    test('shows traceability fields and the summary', async () => {
        apiGet.mockResolvedValue(page([item()]));
        render(<AiFeedback />);
        expect(await screen.findByText('模型：claude-sonnet-5-5')).toBeInTheDocument();
        expect(screen.getByText('提示詞版本：deadbeef')).toBeInTheDocument();
        expect(screen.getByText('Request：req_1')).toBeInTheDocument();
        expect(screen.getByText('太囉嗦')).toBeInTheDocument();
        expect(screen.getByText(/倒讚原因：.*太長 1/)).toBeInTheDocument();
    });

    test('filters go to the query string and reset to page 1', async () => {
        apiGet.mockResolvedValue(page([item()]));
        render(<AiFeedback />);
        await screen.findByText('模型：claude-sonnet-5-5');
        fireEvent.change(screen.getByLabelText('倒讚原因'), { target: { value: 'too_long' } });
        await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining('reason=too_long')));
        expect(apiGet).toHaveBeenLastCalledWith(expect.stringContaining('page=1'));
    });

    test('adding a down-vote to the eval set posts the note and updates the row', async () => {
        apiGet.mockResolvedValue(page([item()]));
        apiPost.mockResolvedValue(item({ evalCandidate: true, evalNote: '一句話就好', evalQuestion: 'lokah 是什麼意思？' }));
        render(<AiFeedback />);
        const note = await screen.findByLabelText('期望的答案方向（選填）');
        fireEvent.change(screen.getByLabelText('重播的問題（請先去掉個資）'), { target: { value: 'lokah 是什麼意思？' } });
        fireEvent.change(note, { target: { value: '一句話就好' } });
        fireEvent.click(screen.getByRole('button', { name: '加入評測題組' }));
        await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
            '/adminapi/ai-feedback/1/eval-candidate/', { candidate: true, note: '一句話就好', question: 'lokah 是什麼意思？' }));
        expect(await screen.findByRole('button', { name: '移出評測題組' })).toBeInTheDocument();
    });

    test('thumbs-up rows cannot be added to the eval set', async () => {
        apiGet.mockResolvedValue(page([item({ rating: 'up', reason: '', comment: '' })]));
        render(<AiFeedback />);
        const table = await screen.findByRole('table');
        expect(within(table).getByText('只有倒讚可以加入')).toBeInTheDocument();
    });

    test('a failed load shows the error instead of stale rows', async () => {
        apiGet.mockRejectedValue(new Error('伺服器錯誤'));
        render(<AiFeedback />);
        expect(await screen.findByText('伺服器錯誤')).toBeInTheDocument();
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
});
