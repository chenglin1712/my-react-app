import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppShell from './AppShell';

const routerState = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: routerState.pathname }) }));
vi.mock('./route', () => ({ default: () => <div>routes</div> }));
vi.mock('./RouteEffects', () => ({ default: () => null }));
vi.mock('../components/navigation/navbar', () => ({
  default: ({ onOpenBot }) => <button onClick={onOpenBot}>open-bot</button>,
}));
vi.mock('../components/ui/Footer', () => ({ default: () => null }));
const authState = vi.hoisted(() => ({ userData: null }));
vi.mock('./userServives/authContext', () => ({ useAuth: () => ({ userData: authState.userData }) }));
vi.mock('../components/_quiz/bot', () => ({
  default: () => { throw new Error('bot render failed'); },
}));

describe('AppShell AI 助手 overlay', () => {
  test('助手 render 丟例外時只顯示提示，不會讓整個畫面變白屏', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppShell />);

    await userEvent.click(screen.getByText('open-bot'));

    expect(await screen.findByRole('alert')).toHaveTextContent('AI 助手暫時無法使用');
    expect(screen.getByText('routes')).toBeInTheDocument();

    await userEvent.click(screen.getByText('關閉'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('routes')).toBeInTheDocument();
  });
});

describe('AppShell 啟動鈕', () => {
  afterEach(() => {
    authState.userData = null;
    routerState.pathname = '/';
  });

  test('助手出錯並關閉提示後，右下角啟動鈕仍在，使用者可以再試', async () => {
    authState.userData = { firestoreData: { name: '小明' } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppShell />);
    await userEvent.click(screen.getByText('open-bot'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByText('關閉'));
    expect(screen.getByRole('button', { name: '開啟 AI 助手' })).toBeInTheDocument();
  });

  test('未登入不顯示啟動鈕', () => {
    render(<AppShell />);
    expect(screen.queryByRole('button', { name: '開啟 AI 助手' })).not.toBeInTheDocument();
  });

  test('/bot 路由本身已有一份聊天視窗：不顯示啟動鈕，也不會另外掛第二份', async () => {
    authState.userData = { firestoreData: { name: '小明' } };
    routerState.pathname = '/bot';
    render(<AppShell />);
    expect(screen.queryByRole('button', { name: '開啟 AI 助手' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('open-bot'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
