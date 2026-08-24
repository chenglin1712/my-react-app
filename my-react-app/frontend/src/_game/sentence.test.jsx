import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SentencePage from './sentence';

describe('SentencePage', () => {
  test('顯示句型練習標題，族語連結指向 /game/sentence/{slug}', () => {
    render(<MemoryRouter><SentencePage /></MemoryRouter>);
    expect(screen.getByText('句型練習')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /泰雅族語/ })).toHaveAttribute('href', '/game/sentence/tayal');
  });
});
