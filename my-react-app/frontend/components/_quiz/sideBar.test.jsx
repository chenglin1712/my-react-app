import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import SideBar from './sideBar';

const mockNavigate = vi.fn();
let mockPathname = '/quiz';
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

describe('SideBar（FR-4a：active 狀態改成完全由目前路徑推導，不再另存一份可能不同步的 state）', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  test('路徑是 /quiz/amis/recommon 時，推薦測驗項目顯示 active', () => {
    mockPathname = '/quiz/amis/recommon';
    const { container } = render(<SideBar />);

    expect(container.querySelector('.bar-item.active')).toHaveTextContent('進階-推薦測驗');
  });

  test('路徑是 /quiz/2（泰雅語，無族語前綴）時，基礎測驗項目 active', () => {
    mockPathname = '/quiz/2';
    const { container } = render(<SideBar />);

    expect(container.querySelector('.bar-item.active')).toHaveTextContent('基礎-等級測驗');
  });

  test('路徑是 /quiz/situation 時，答題情形項目 active', () => {
    mockPathname = '/quiz/situation';
    const { container } = render(<SideBar />);

    expect(container.querySelector('.bar-item.active')).toHaveTextContent('答題情形');
  });
});
