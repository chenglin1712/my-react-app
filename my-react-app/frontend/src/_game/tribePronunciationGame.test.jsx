import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TribePronunciationGame from './tribePronunciationGame';

vi.mock('../../components/_game/pronunciation_game', () => ({ default: ({ tribe }) => <div>遊戲畫面：{tribe}</div> }));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/game/pronunciation/:tribe" element={<TribePronunciationGame />} />
        <Route path="/game/pronunciation" element={<div>選擇族語頁面</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TribePronunciationGame（回歸測試：原本網址帶不存在的族語時標題保底顯示泰雅語，但仍把無效的 slug 送給後端）', () => {
  test('有效的族語 slug 正常顯示標題跟遊戲畫面', () => {
    renderAt('/game/pronunciation/paiwan');
    expect(screen.getByText('Qmisan PAIWAN - 排灣族語發音練習')).toBeInTheDocument();
    expect(screen.getByText('遊戲畫面：paiwan')).toBeInTheDocument();
  });

  test('無效的族語 slug 導回選擇族語頁面', () => {
    renderAt('/game/pronunciation/not-a-tribe');
    expect(screen.getByText('選擇族語頁面')).toBeInTheDocument();
  });
});
