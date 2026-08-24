import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TribeSentenceGame from './tribeSentenceGame';

vi.mock('../../components/_game/sentence_game', () => ({ default: ({ tribe }) => <div>遊戲畫面：{tribe}</div> }));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/game/sentence/:tribe" element={<TribeSentenceGame />} />
        <Route path="/game/sentence" element={<div>選擇族語頁面</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TribeSentenceGame（回歸測試：原本網址帶不存在的族語時標題保底顯示泰雅語，但仍把無效的 slug 送給後端）', () => {
  test('有效的族語 slug 正常顯示標題跟遊戲畫面', () => {
    renderAt('/game/sentence/kavalan');
    expect(screen.getByText('Lmuhuw KAVALAN - 噶瑪蘭句型練習')).toBeInTheDocument();
    expect(screen.getByText('遊戲畫面：kavalan')).toBeInTheDocument();
  });

  test('無效的族語 slug 導回選擇族語頁面', () => {
    renderAt('/game/sentence/not-a-tribe');
    expect(screen.getByText('選擇族語頁面')).toBeInTheDocument();
  });
});
