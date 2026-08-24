import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TribeVocabularyGame from './tribeVocabularyGame';

vi.mock('../../components/_game/game_start', () => ({ default: ({ tribe }) => <div>遊戲畫面：{tribe}</div> }));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/game/vocabulary/:tribe" element={<TribeVocabularyGame />} />
        <Route path="/game/vocabulary" element={<div>選擇族語頁面</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TribeVocabularyGame（回歸測試：原本網址帶不存在的族語時標題保底顯示泰雅語，但仍把無效的 slug 送給後端）', () => {
  test('有效的族語 slug 會正常顯示標題跟遊戲畫面', () => {
    renderAt('/game/vocabulary/amis');
    expect(screen.getByText('Sowal no Pangcah - 阿美族語')).toBeInTheDocument();
    expect(screen.getByText('遊戲畫面：amis')).toBeInTheDocument();
  });

  test('網址帶不存在的族語 slug 時導回選擇族語頁面，不會用泰雅語的畫面掩蓋掉這個錯誤', () => {
    renderAt('/game/vocabulary/not-a-real-tribe');
    expect(screen.getByText('選擇族語頁面')).toBeInTheDocument();
    expect(screen.queryByText('遊戲畫面：not-a-real-tribe')).not.toBeInTheDocument();
  });
});
