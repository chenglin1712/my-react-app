import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ListeningPage from './listening';

describe('ListeningPage', () => {
  test('顯示聽力遊戲標題，族語連結指向 /game/listening/{slug}', () => {
    render(<MemoryRouter><ListeningPage /></MemoryRouter>);
    expect(screen.getByText('聽力遊戲')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /泰雅族語/ })).toHaveAttribute('href', '/game/listening/tayal');
  });
});
