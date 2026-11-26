import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TribeGamePage from './TribeGamePage';

const TITLES = { tayal: '標題一', amis: '標題二' };
const FakeGame = ({ tribe }) => <div>遊戲畫面：{tribe}</div>;

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/game/x/:tribe" element={<TribeGamePage titles={TITLES} fallbackPath="/game/x" GameComponent={FakeGame} />} />
        <Route path="/game/x" element={<div>選擇族語頁面</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TribeGamePage（共用：驗證 :tribe 網址參數，取代原本每個遊戲各自複製一份的重複登入檢查與無效 slug 處理）', () => {
  test('有效的族語 slug 顯示對應標題跟遊戲畫面', () => {
    renderAt('/game/x/amis');
    expect(screen.getByText('標題二')).toBeInTheDocument();
    expect(screen.getByText('遊戲畫面：amis')).toBeInTheDocument();
  });

  // 稽核 FE5-15：titles 只寫了目前的幾個族群，新啟用的族群沒有條目時標題不能是空的
  test('titles 沒有這個族群的條目時，標題用族名組出保底文字，不是空白', () => {
    renderAt('/game/x/bunun');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('族語練習');
    expect(heading.textContent.trim().length).toBeGreaterThan('族語練習'.length);
    expect(screen.getByText('遊戲畫面：bunun')).toBeInTheDocument();
  });

  test('無效的族語 slug 導回 fallbackPath，不會渲染遊戲畫面', () => {
    renderAt('/game/x/not-a-tribe');
    expect(screen.getByText('選擇族語頁面')).toBeInTheDocument();
    expect(screen.queryByText(/遊戲畫面/)).not.toBeInTheDocument();
  });
});
