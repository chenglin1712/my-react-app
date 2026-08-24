import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuizTribeSelect from './tribeSelect';

describe('QuizTribeSelect（回歸測試：原本副標題顯示的是英文 slug 首字大寫，不是族語真正的羅馬拼音自稱）', () => {
  test('每個族語都是可鍵盤操作的連結，泰雅語導向 /quiz，其餘導向 /quiz/{slug}', () => {
    render(<MemoryRouter><QuizTribeSelect /></MemoryRouter>);

    const tayalLink = screen.getByRole('link', { name: /泰雅族語/ });
    expect(tayalLink).toHaveAttribute('href', '/quiz');

    const amisLink = screen.getByRole('link', { name: /阿美族語/ });
    expect(amisLink).toHaveAttribute('href', '/quiz/amis');
  });

  test('副標題顯示族語自己的羅馬拼音名稱，不是英文 slug 首字大寫', () => {
    render(<MemoryRouter><QuizTribeSelect /></MemoryRouter>);

    // 阿美族語的羅馬拼音自稱是 Pangcah，不是把 slug "amis" 首字大寫變成 "Amis"
    expect(screen.getByText('Pangcah')).toBeInTheDocument();
    expect(screen.queryByText('Amis')).not.toBeInTheDocument();
  });

  test('沒有任何一個族語顯示成建置中/停用狀態', () => {
    render(<MemoryRouter><QuizTribeSelect /></MemoryRouter>);
    expect(screen.queryByText('建置中，敬請期待')).not.toBeInTheDocument();
  });
});
