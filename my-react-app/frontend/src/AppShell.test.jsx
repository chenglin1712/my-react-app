import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppShell from './AppShell';

vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/' }) }));
vi.mock('./route', () => ({ default: () => <div>routes</div> }));
vi.mock('./RouteEffects', () => ({ default: () => null }));
vi.mock('../components/navigation/navbar', () => ({
  default: ({ onOpenBot }) => <button onClick={onOpenBot}>open-bot</button>,
}));
vi.mock('../components/ui/Footer', () => ({ default: () => null }));
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
