// 首頁雜誌版導覽（步驟 2-3）：選單列貼頂（sticky）才顯示玻璃底與左側小字標「原語」。
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import Navbar from './navbar';

const slotState = vi.hoisted(() => ({ slot: null }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/' }),
  NavLink: ({ to, className, children, onClick, ...rest }) => (
    <a href={to} className={className} onClick={(e) => { e.preventDefault(); onClick?.(); }} {...rest}>{children}</a>
  ),
}));
vi.mock('../../src/userServives/authContext', () => ({ useAuth: () => ({ userData: null }) }));
vi.mock('./userSidebar', () => ({ default: () => null }));
vi.mock('../../src/homeNavSlot', () => ({ useHomeNavSlot: () => ({ slot: slotState.slot }) }));

const setup = (top) => {
  const slot = document.createElement('div');
  slot.getBoundingClientRect = () => ({ top });
  document.body.appendChild(slot);
  slotState.slot = slot;
  return slot;
};

afterEach(() => {
  slotState.slot = null;
  document.body.innerHTML = '';
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
});

const scrollTo = async (y) => {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
  await act(async () => {
    window.dispatchEvent(new Event('scroll'));
    await new Promise((r) => requestAnimationFrame(r));
  });
};

describe('首頁雜誌版導覽', () => {
  test('一開始未貼頂：data-stuck=false，小字標不可被 Tab 聚焦', () => {
    const slot = setup(120);
    render(<Navbar />);
    const nav = slot.querySelector('nav');
    expect(nav).toHaveAttribute('data-stuck', 'false');
    const mini = nav.querySelector('.logo--mini');
    expect(mini).toHaveTextContent('原語');
    expect(mini).toHaveAttribute('tabindex', '-1');
  });

  test('捲動後 slot 貼到頂端：data-stuck=true，小字標可聚焦，名稱以可見文字「原語」開頭', async () => {
    const slot = setup(0);
    render(<Navbar />);
    await scrollTo(400);
    const nav = slot.querySelector('nav');
    expect(nav).toHaveAttribute('data-stuck', 'true');
    const mini = nav.querySelector('.logo--mini');
    expect(mini).not.toHaveAttribute('tabindex');
    expect(mini.getAttribute('aria-label').startsWith('原語')).toBe(true);
  });

  test('捲回頂端：恢復未貼頂', async () => {
    const slot = setup(0);
    render(<Navbar />);
    await scrollTo(400);
    await scrollTo(0);
    expect(slot.querySelector('nav')).toHaveAttribute('data-stuck', 'false');
  });

  test('選單項目不增不減：六個主項加筆記下拉', () => {
    const slot = setup(120);
    render(<Navbar />);
    const labels = [...slot.querySelectorAll('.menu .menu-item span')].map((s) => s.textContent).filter(Boolean);
    ['首頁', '單詞查詢', '翻譯', '影像辨識', '遊戲專區', '測驗', '筆記'].forEach((l) => expect(labels).toContain(l));
  });
});
