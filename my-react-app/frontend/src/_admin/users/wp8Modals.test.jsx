import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import DeleteAccountModal from './DeleteAccountModal';
import PasswordChangeModal from './PasswordChangeModal';
import ProfileEditModal from './ProfileEditModal';
import { apiPatch, apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiPost: vi.fn(),
    apiPatch: vi.fn(),
}));

vi.mock('../hooks/useMediaUpload', () => ({
    useMediaUpload: () => ({
        error: '', previews: {}, isUploading: () => false, upload: vi.fn(),
    }),
}));

// 稽核 FE7b-01／FE7b-15：對話框內顯示錯誤、Email 確認不分大小寫與前後空白

describe('DeleteAccountModal', () => {
    const onError = vi.fn();
    const onDeleted = vi.fn();

    beforeEach(() => {
        apiPost.mockReset();
        onError.mockReset();
        onDeleted.mockReset();
    });

    const renderModal = (user = { email: 'User@Example.com' }) => render(
        <DeleteAccountModal
            show
            user={user}
            uid="u1"
            onClose={() => {}}
            onDeleted={onDeleted}
            onError={onError}
        />,
    );

    test('刪除失敗時錯誤顯示在對話框內（role=alert），不交給背後的頁面', async () => {
        apiPost.mockRejectedValue(new Error('後端拒絕刪除'));
        renderModal();

        fireEvent.change(screen.getByLabelText('輸入帳號 Email 以確認刪除'), {
            target: { value: 'User@Example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: /確認刪除/ }));

        const dialog = await screen.findByRole('dialog');
        const message = await within(dialog).findByText('後端拒絕刪除');
        expect(message).toHaveAttribute('role', 'alert');
        expect(onError).not.toHaveBeenCalledWith('後端拒絕刪除');
    });

    test('Email 比對忽略大小寫與前後空白，送出時仍帶帳號真實 email', async () => {
        apiPost.mockResolvedValue({ results: {} });
        renderModal();

        const confirm = screen.getByRole('button', { name: /確認刪除/ });
        expect(confirm).toBeDisabled();

        fireEvent.change(screen.getByLabelText('輸入帳號 Email 以確認刪除'), {
            target: { value: '  user@example.COM ' },
        });
        expect(confirm).toBeEnabled();

        fireEvent.click(confirm);
        await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
            '/adminapi/users/u1/delete/',
            { confirm_email: 'User@Example.com' },
        ));
    });

    // WP-8 追加：沒有 email 的帳號改用 UID 確認（原本這裡測的是「無法送出」，規則已改）
    test('沒有 email 的帳號改輸入 UID 確認，逐字相符才可送出並帶 confirm_uid', async () => {
        apiPost.mockResolvedValue({ results: {} });
        renderModal({ email: '', uid: 'AbC123' });

        expect(screen.getByText(/此帳號沒有 email/)).toBeInTheDocument();
        expect(screen.queryByText(/請聯繫系統管理員/)).not.toBeInTheDocument();
        const confirm = screen.getByRole('button', { name: /確認刪除/ });
        expect(confirm).toBeDisabled();

        const input = screen.getByLabelText('輸入帳號 UID 以確認刪除');
        // UID 有大小寫之分，不能像 email 一樣忽略大小寫
        fireEvent.change(input, { target: { value: 'abc123' } });
        expect(confirm).toBeDisabled();
        fireEvent.change(input, { target: { value: ' AbC123 ' } });
        expect(confirm).toBeEnabled();

        fireEvent.click(confirm);
        await waitFor(() => expect(apiPost).toHaveBeenCalledWith(
            '/adminapi/users/u1/delete/',
            { confirm_uid: 'AbC123' },
        ));
    });

    test('沒有 email 且 user 物件沒有 uid 時，退回使用路由的 uid', () => {
        renderModal({ email: '' });
        fireEvent.change(screen.getByLabelText('輸入帳號 UID 以確認刪除'), { target: { value: 'u1' } });
        expect(screen.getByRole('button', { name: /確認刪除/ })).toBeEnabled();
    });
});

describe('ProfileEditModal', () => {
    beforeEach(() => {
        apiPatch.mockReset();
    });

    const renderProfile = (user, onSaved = vi.fn()) => render(
        <ProfileEditModal
            show
            user={user}
            uid="u1"
            onClose={() => {}}
            onSaved={onSaved}
            onError={() => {}}
        />,
    );

    // WP-8 追加（FE7b-15 殘留）：清空 email 原本不送卻顯示「已更新」，現在改為阻止送出
    test('原本有 email 的帳號清空 Email 欄時阻止送出並說明無法移除', () => {
        renderProfile({ name: 'A', email: 'a@b.com' });

        fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  ' } });

        expect(screen.getByText('Email 無法移除，只能改成新的 Email。')).toBeInTheDocument();
        const save = screen.getByRole('button', { name: /儲存/ });
        expect(save).toBeDisabled();
        fireEvent.submit(save.closest('form'));
        expect(apiPatch).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Email 無法移除');
    });

    test('沒有 email 的帳號留空可以儲存，且不送 email 欄位', async () => {
        apiPatch.mockResolvedValue({});
        const onSaved = vi.fn();
        renderProfile({ name: 'A', email: '' }, onSaved);

        fireEvent.click(screen.getByRole('button', { name: /儲存/ }));

        await waitFor(() => expect(onSaved).toHaveBeenCalled());
        expect(apiPatch.mock.calls[0][1]).not.toHaveProperty('email');
    });
});

describe('PasswordChangeModal', () => {
    beforeEach(() => {
        apiPost.mockReset();
    });

    test('變更失敗時錯誤顯示在對話框內，Email 不分大小寫', async () => {
        apiPost.mockRejectedValue(new Error('密碼太弱'));
        const onError = vi.fn();

        render(
            <PasswordChangeModal
                show
                user={{ email: 'A@b.com' }}
                uid="u1"
                onClose={() => {}}
                onSaved={() => {}}
                onError={onError}
            />,
        );

        fireEvent.change(screen.getByLabelText('新密碼'), { target: { value: 'abcdef' } });
        fireEvent.change(screen.getByLabelText('確認新密碼'), { target: { value: 'abcdef' } });
        fireEvent.change(screen.getByLabelText('輸入帳號 Email 以確認變更密碼'), {
            target: { value: ' a@B.com ' },
        });
        fireEvent.click(screen.getByRole('button', { name: /確認變更密碼/ }));

        const message = await screen.findByText('密碼太弱');
        expect(message).toHaveAttribute('role', 'alert');
        expect(apiPost).toHaveBeenCalledWith(
            '/adminapi/users/u1/password/',
            { new_password: 'abcdef', confirm_email: 'A@b.com' },
        );
        expect(onError).not.toHaveBeenCalledWith('密碼太弱');
    });
});
