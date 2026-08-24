import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import QuizLayout from './index';

/** /quiz 已經巢狀在 route.jsx 的 ProtectedLayout 底下，登入檢查在那裡已經
 * 做過一次；這裡驗證 QuizLayout 本身不會再自己判斷 userData（不然沒登入時
 * ProtectedLayout 顯示 PermissionProtect、這裡又顯示一次，變成兩處各自維護
 * 一份登入判斷邏輯）。 */
vi.mock('../../components/_quiz/sideBar', () => ({ default: () => <div>側邊欄</div> }));

function ThrowingChild() {
  throw new Error('題目渲染失敗');
}

describe('QuizLayout', () => {
  test('直接渲染側邊欄跟子路由內容，不會自己再判斷登入狀態', () => {
    render(
      <MemoryRouter initialEntries={['/quiz']}>
        <Routes>
          <Route path="/quiz" element={<QuizLayout />}>
            <Route index element={<div>測驗內容</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('側邊欄')).toBeInTheDocument();
    expect(screen.getByText('測驗內容')).toBeInTheDocument();
  });

  test('子路由渲染時丟出例外會被 scoped error boundary 接住，側邊欄仍然看得到', () => {
    render(
      <MemoryRouter initialEntries={['/quiz']}>
        <Routes>
          <Route path="/quiz" element={<QuizLayout />}>
            <Route index element={<ThrowingChild />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('側邊欄')).toBeInTheDocument();
    expect(screen.getByText('這個測驗載入時發生問題')).toBeInTheDocument();
  });
});
