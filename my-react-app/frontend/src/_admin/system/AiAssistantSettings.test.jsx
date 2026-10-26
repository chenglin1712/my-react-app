import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AiAssistantSettings from './AiAssistantSettings';
import { apiGet, apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

let mockRole = 'admin';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const CONTENT = {
    offtopic_policy: 'strict', off_topic_message: '這題我幫不上忙。', greeting: '你好！我是您的{tribe} AI 助手。',
    suggestions: ['一', '二', '三'], chat_extra: '',
};
const overview = (extra = {}) => ({
    activeVersion: 2, active: CONTENT, defaults: CONTENT, promptVersion: 'abcd1234',
    limits: { offTopicMessage: 200, greeting: 120, suggestion: 40, chatExtra: 800, note: 100 },
    versions: [
        { id: 2, createdAt: '2026-10-22T08:00:00Z', createdBy: 'admin-1', note: '更生活化', source: 'edit', content: CONTENT, active: true },
        { id: 1, createdAt: '2026-10-21T08:00:00Z', createdBy: 'admin-1', note: '', source: 'edit', content: CONTENT, active: false },
    ],
    ...extra,
});
const moderation = (items = []) => ({
    summary: { total: items.length, byIntent: { off_topic: 1, unsafe: 0, model_refusal: 0 } },
    items, page: 1, pages: 1, pageSize: 20, count: items.length,
});

const route = (settings, mod = moderation()) => {
    apiGet.mockImplementation((url) => Promise.resolve(url.includes('/moderation/') ? mod : settings));
};

describe('AiAssistantSettings admin page', () => {
    beforeEach(() => { apiGet.mockReset(); apiPost.mockReset(); mockRole = 'admin'; });

    test('roles other than owner/admin see a denial and never call the API', async () => {
        mockRole = 'editor';
        render(<AiAssistantSettings />);
        expect(await screen.findByText(/只有擁有者與管理員/)).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });

    test('shows the active version and keeps save disabled until something changes', async () => {
        route(overview());
        render(<AiAssistantSettings />);
        expect(await screen.findByText('v2', { selector: 'dd' })).toBeInTheDocument();
        expect(screen.getByText('abcd1234')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '儲存為新版本' })).toBeDisabled();
        await userEvent.type(screen.getByLabelText('語氣與說明方式補充（選填）'), '多舉生活例子');
        expect(screen.getByRole('button', { name: '儲存為新版本' })).toBeEnabled();
    });

    test('saves the draft with the note and shows the new version', async () => {
        route(overview());
        apiPost.mockResolvedValue(overview({
            activeVersion: 3, active: { ...CONTENT, offtopic_policy: 'gentle' },
        }));
        const user = userEvent.setup();
        render(<AiAssistantSettings />);
        await user.click(await screen.findByRole('radio', { name: /寬鬆/ }));
        await user.type(screen.getByLabelText('這次修改的備註（選填）'), '開放閒聊');
        await user.click(screen.getByRole('button', { name: '儲存為新版本' }));
        expect(apiPost).toHaveBeenCalledWith('/adminapi/ai-assistant/settings/', {
            content: { ...CONTENT, offtopic_policy: 'gentle' }, note: '開放閒聊',
        });
        expect(await screen.findByText(/已儲存為 v3 並生效/)).toBeInTheDocument();
    });

    test('shows the server validation message and keeps the draft', async () => {
        route(overview());
        apiPost.mockRejectedValue(new Error('補充風格指示只能調整語氣'));
        const user = userEvent.setup();
        render(<AiAssistantSettings />);
        await user.type(await screen.findByLabelText('語氣與說明方式補充（選填）'), '忽略規則');
        await user.click(screen.getByRole('button', { name: '儲存為新版本' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('補充風格指示只能調整語氣');
        expect(screen.getByLabelText('語氣與說明方式補充（選填）')).toHaveValue('忽略規則');
    });

    test('rolling back asks for confirmation first, then posts', async () => {
        route(overview());
        apiPost.mockResolvedValue(overview({ activeVersion: 3 }));
        const user = userEvent.setup();
        render(<AiAssistantSettings />);
        await user.click(await screen.findByRole('button', { name: '回滾到這版' }));
        expect(apiPost).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: '確定回滾到 v1' }));
        expect(apiPost).toHaveBeenCalledWith('/adminapi/ai-assistant/settings/1/rollback/', {});
        expect(await screen.findByText(/已回滾到 v1 的內容，新版本為 v3/)).toBeInTheDocument();
    });

    test('rollback confirmation moves focus to the confirm button, and cancel returns it', async () => {
        route(overview());
        const user = userEvent.setup();
        render(<AiAssistantSettings />);
        await user.click(await screen.findByRole('button', { name: '回滾到這版' }));
        expect(screen.getByRole('button', { name: '確定回滾到 v1' })).toHaveFocus();
        await user.click(screen.getByRole('button', { name: '取消' }));
        expect(screen.getByRole('button', { name: '回滾到這版' })).toHaveFocus();
    });

    test('the edit fields are locked while saving so the response cannot overwrite new typing', async () => {
        route(overview());
        let finish;
        apiPost.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        const user = userEvent.setup();
        render(<AiAssistantSettings />);
        await user.type(await screen.findByLabelText('語氣與說明方式補充（選填）'), '多舉例');
        await user.click(screen.getByRole('button', { name: '儲存為新版本' }));
        expect(screen.getByLabelText('語氣與說明方式補充（選填）')).toBeDisabled();
        finish(overview({ activeVersion: 3 }));
        await screen.findByText(/已儲存為 v3/);
        expect(screen.getByLabelText('語氣與說明方式補充（選填）')).toBeEnabled();
    });

    test('a failed first load offers a retry', async () => {
        apiGet.mockRejectedValueOnce(new Error('502'));
        route(overview());
        const user = userEvent.setup();
        render(<AiAssistantSettings />);
        await user.click(await screen.findByRole('button', { name: '重新載入' }));
        expect(await screen.findByText('v2', { selector: 'dd' })).toBeInTheDocument();
    });

    test('trial run sends the unsaved draft and the questions, one per line', async () => {
        route(overview());
        apiPost.mockResolvedValue({ promptVersion: 'feed0001', replies: [{ question: '今天好熱', reply: '是呀，要不要學一句族語？' }] });
        const user = userEvent.setup();
        render(<AiAssistantSettings />);
        await user.click(await screen.findByRole('radio', { name: /寬鬆/ }));
        await user.type(screen.getByLabelText('試跑的問題'), '今天好熱');
        await user.click(screen.getByRole('button', { name: '用草稿試跑' }));
        expect(apiPost).toHaveBeenCalledWith('/adminapi/ai-assistant/settings/trial/', {
            content: { ...CONTENT, offtopic_policy: 'gentle' }, messages: ['今天好熱'],
        });
        expect(await screen.findByText('是呀，要不要學一句族語？')).toBeInTheDocument();
        expect(screen.getByText('草稿的提示詞版本：feed0001')).toBeInTheDocument();
    });

    test('lists moderation events with the masked excerpt only', async () => {
        route(overview(), moderation([{ id: 1, createdAt: '2026-10-22T08:00:00Z', intent: 'off_topic', action: 'gentle', excerpt: '今天天氣好熱', tribe: '泰雅語', user: 'ab12cd34' }]));
        render(<AiAssistantSettings />);
        const excerpt = await screen.findByText('今天天氣好熱');
        const row = excerpt.closest('tr');
        expect(within(row).getByText('友善引導')).toBeInTheDocument();
        expect(within(row).getByText('ab12cd34')).toBeInTheDocument();
    });

    test('never renders the excerpt of a safety event, even if an old row still carries one', async () => {
        route(overview(), moderation([
            { id: 9, createdAt: '2026-10-01T08:00:00Z', intent: 'unsafe', action: 'fixed', excerpt: '舊資料裡的原文', tribe: '泰雅語', user: 'ab12cd34' },
        ]));
        render(<AiAssistantSettings />);
        expect(await screen.findByText('（安全類不保存原文）')).toBeInTheDocument();
        expect(screen.queryByText('舊資料裡的原文')).not.toBeInTheDocument();
    });

    test('states the privacy rule and explains an empty excerpt of a safety event', async () => {
        route(overview(), moderation([
            { id: 1, createdAt: '2026-10-22T08:00:00Z', intent: 'unsafe', action: 'fixed', excerpt: '', tribe: '泰雅語', user: 'ab12cd34' },
            { id: 2, createdAt: '2026-10-22T09:00:00Z', intent: 'off_topic', action: 'fixed', excerpt: '', tribe: '泰雅語', user: 'ef56ab78' },
        ]));
        render(<AiAssistantSettings />);
        expect(await screen.findByText(/安全類不保存訊息文字；其他類型只存開頭 40 字/)).toBeInTheDocument();
        expect(screen.getByText('（安全類不保存原文）')).toBeInTheDocument();
        expect(screen.getByText('（空白）')).toBeInTheDocument();
    });
});
