import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BotLauncher from './BotLauncher';

const auth = vi.hoisted(() => ({ current: { userData: { firestoreData: {} } } }));
vi.mock('../../src/userServives/authContext', () => ({ useAuth: () => auth.current }));

describe('BotLauncher（P4-8：玻璃膠囊）', () => {
  test('是玻璃膠囊：圖示加可見文字「AI 助手」，無障礙名稱包含這段文字', () => {
    auth.current = { userData: { firestoreData: {} } };
    render(<BotLauncher onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: '開啟 AI 助手' });
    expect(btn).toHaveClass('yy-glass', 'bot-launcher');
    expect(btn).toHaveTextContent('AI 助手');
    expect(btn.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('點擊呼叫 onClick；未登入不顯示', () => {
    const onClick = vi.fn();
    auth.current = { userData: { firestoreData: {} } };
    const { unmount } = render(<BotLauncher onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: '開啟 AI 助手' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    unmount();
    auth.current = { userData: null };
    render(<BotLauncher onClick={onClick} />);
    expect(screen.queryByRole('button', { name: '開啟 AI 助手' })).not.toBeInTheDocument();
  });
});
