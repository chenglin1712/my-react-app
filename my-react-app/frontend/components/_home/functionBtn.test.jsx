import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FunctionBtn from './functionBtn';

function renderBtn(props) {
  return render(
    <MemoryRouter>
      <FunctionBtn {...props} />
    </MemoryRouter>,
  );
}

describe('FunctionBtn', () => {
  test('沒有帶 enabled prop 時三張卡片預設全部顯示', () => {
    renderBtn();
    expect(screen.getByText('影像辨識')).toBeInTheDocument();
    expect(screen.getByText('詞彙遊戲')).toBeInTheDocument();
    expect(screen.getByText('測驗學習')).toBeInTheDocument();
  });

  test('依 enabled 旗標隱藏被關閉的卡片，只保留內容/導向不能被後台亂改的其餘卡片', () => {
    renderBtn({ enabled: { button1: false, button2: true, button3: false } });
    expect(screen.queryByText('影像辨識')).not.toBeInTheDocument();
    expect(screen.getByText('詞彙遊戲')).toBeInTheDocument();
    expect(screen.queryByText('測驗學習')).not.toBeInTheDocument();
  });

  test('辭典是第一張卡，永遠顯示，且不受後台開關影響', () => {
    renderBtn({ enabled: { button1: false, button2: false, button3: false } });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/search');
    expect(screen.getByRole('link', { name: '單詞查詢' })).toBeInTheDocument();
  });

  test('卡片順序：辭典、影像辨識、詞彙遊戲、測驗學習', () => {
    renderBtn();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href')))
      .toEqual(['/search', '/camera', '/game', '/quiz/select']);
  });

  test('訪客：需要登入的三張卡標「會員」並納入無障礙名稱，辭典不標', () => {
    renderBtn({ isGuest: true });
    expect(screen.getByRole('link', { name: '影像辨識 會員' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '詞彙遊戲 會員' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '測驗學習 會員' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '單詞查詢' })).toBeInTheDocument();
    expect(screen.getAllByText('會員')).toHaveLength(3);
  });

  test('已登入：不標會員，名稱只有標題，說明放在 aria-describedby', () => {
    renderBtn();
    expect(screen.queryByText('會員')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: '影像辨識' });
    expect(link).toHaveAccessibleDescription(/相機/);
  });

  test('卡片標題是 h3，在「功能模組」h2 底下', () => {
    renderBtn();
    expect(screen.getByRole('heading', { level: 2, name: '功能模組' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
  });
});
