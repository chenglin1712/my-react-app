import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PronunciationPage from './pronunciation';

describe('PronunciationPage', () => {
  test('顯示發音練習標題，族語連結指向 /game/pronunciation/{slug}', () => {
    render(<MemoryRouter><PronunciationPage /></MemoryRouter>);
    expect(screen.getByText('發音練習')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /泰雅族語/ })).toHaveAttribute('href', '/game/pronunciation/tayal');
  });
});
