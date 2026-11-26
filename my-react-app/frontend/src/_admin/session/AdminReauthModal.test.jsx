import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminReauthModal from './AdminReauthModal';
import { REAUTH_REQUIRED_EVENT } from './adminSession';

const mockReauth = vi.fn();
const mockGetIdToken = vi.fn(() => Promise.resolve('new-token'));
vi.mock('firebase/auth', () => ({
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    reauthenticateWithCredential: (...args) => mockReauth(...args),
}));
vi.mock('../../../../firebase', () => ({
    auth: { currentUser: { email: 'staff@example.com', getIdToken: (...a) => mockGetIdToken(...a) } },
}));

const open = () => act(() => { window.dispatchEvent(new CustomEvent(REAUTH_REQUIRED_EVENT)); });

describe('AdminReauthModal', () => {
    beforeEach(() => {
        mockReauth.mockReset();
        mockGetIdToken.mockClear();
    });

    test('平常不顯示，收到事件才跳出並顯示目前帳號', () => {
        render(<AdminReauthModal />);
        expect(screen.queryByText('請重新驗證身分')).not.toBeInTheDocument();
        open();
        expect(screen.getByText('請重新驗證身分')).toBeInTheDocument();
        expect(screen.getByDisplayValue('staff@example.com')).toBeInTheDocument();
    });

    test('沒輸入密碼不送出', () => {
        render(<AdminReauthModal />);
        open();
        fireEvent.click(screen.getByRole('button', { name: '驗證' }));
        expect(screen.getByText('請輸入密碼。')).toBeInTheDocument();
        expect(mockReauth).not.toHaveBeenCalled();
    });

    test('密碼正確：重新驗證並強制換發 token，提示頁面內容還在', async () => {
        mockReauth.mockResolvedValueOnce({});
        render(<AdminReauthModal />);
        open();
        fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret1' } });
        fireEvent.click(screen.getByRole('button', { name: '驗證' }));
        await waitFor(() => expect(screen.getByText(/已重新驗證/)).toBeInTheDocument());
        expect(mockReauth.mock.calls[0][1]).toEqual({ email: 'staff@example.com', password: 'secret1' });
        expect(mockGetIdToken).toHaveBeenCalledWith(true);
    });

    /** 稽核 FE7a-18：同一批請求同時回 401 會連發多次事件，後來的事件不能清掉使用者已輸入的密碼。 */
    test('視窗已開啟時再收到事件：不清空已輸入的密碼', () => {
        render(<AdminReauthModal />);
        open();
        fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'typing' } });

        open();
        open();

        expect(screen.getByLabelText('密碼')).toHaveValue('typing');
    });

    test('視窗已開啟、顯示錯誤訊息時再收到事件：錯誤不會被清掉', async () => {
        mockReauth.mockRejectedValueOnce({ code: 'auth/invalid-credential' });
        render(<AdminReauthModal />);
        open();
        fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: '驗證' }));
        await screen.findByText('密碼錯誤，請再試一次。');

        open();

        expect(screen.getByText('密碼錯誤，請再試一次。')).toBeInTheDocument();
    });

    test('驗證成功（done）後再收到事件：重新開啟並回到輸入密碼的狀態', async () => {
        mockReauth.mockResolvedValueOnce({});
        render(<AdminReauthModal />);
        open();
        fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'secret1' } });
        fireEvent.click(screen.getByRole('button', { name: '驗證' }));
        await screen.findByText(/已重新驗證/);

        open();

        expect(screen.queryByText(/已重新驗證/)).not.toBeInTheDocument();
        expect(screen.getByLabelText('密碼')).toHaveValue('');
    });

    test('關閉後再收到事件：會重新開啟', async () => {
        render(<AdminReauthModal />);
        open();
        fireEvent.click(screen.getByRole('button', { name: '稍後再說' }));
        await waitFor(() => expect(screen.queryByText('請重新驗證身分')).not.toBeInTheDocument());

        open();
        expect(screen.getByText('請重新驗證身分')).toBeInTheDocument();
    });

    test('密碼錯誤：顯示錯誤、不換發 token', async () => {
        mockReauth.mockRejectedValueOnce({ code: 'auth/invalid-credential' });
        render(<AdminReauthModal />);
        open();
        fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: '驗證' }));
        await waitFor(() => expect(screen.getByText('密碼錯誤，請再試一次。')).toBeInTheDocument());
        expect(mockGetIdToken).not.toHaveBeenCalled();
    });
});
