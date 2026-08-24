import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TribePronunciationCommunity from './pronunciationCommunity';

vi.mock('../../components/_game/pronunciation/PronunciationCommunity', () => ({
  default: ({ tribe }) => <div>社群畫面：{tribe}</div>,
}));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/game/pronunciation/:tribe/community" element={<TribePronunciationCommunity />} />
        <Route path="/game/pronunciation" element={<div>選擇族語頁面</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TribePronunciationCommunity（回歸測試：原本網址帶不存在的族語時標題保底顯示泰雅語，但仍把無效的 slug 傳給內層元件）', () => {
  test('有效的族語 slug 正常顯示標題，並把 tribe 當 prop 傳給社群元件（不是讓它自己讀路由參數）', () => {
    renderAt('/game/pronunciation/bunun/community');
    expect(screen.getByText('Qmisan BUNUN - 布農族語社群示範發音')).toBeInTheDocument();
    expect(screen.getByText('社群畫面：bunun')).toBeInTheDocument();
  });

  test('無效的族語 slug 導回選擇族語頁面', () => {
    renderAt('/game/pronunciation/not-a-tribe/community');
    expect(screen.getByText('選擇族語頁面')).toBeInTheDocument();
  });
});
