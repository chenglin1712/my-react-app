import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeTicker from './Ticker';
import tickerSource from './Ticker.jsx?raw';
import mastheadSource from './Masthead.jsx?raw';

const stubReducedMotion = (reduced) => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

afterEach(() => {
  delete window.matchMedia;
});

const ITEMS = ['第一則訊息', '第二則訊息', '第三則訊息'];

describe('HomeTicker（動態）', () => {
  test('項目都在，並有一份對輔助技術隱藏、不可聚焦的複本（只為了無縫循環）', () => {
    const { container } = render(<HomeTicker items={ITEMS} />);
    const lists = container.querySelectorAll('.home-ticker__copy');
    expect(lists).toHaveLength(2);
    expect(lists[0]).not.toHaveAttribute('aria-hidden');
    expect(lists[1]).toHaveAttribute('aria-hidden', 'true');
    expect(lists[1]).toHaveAttribute('inert');
    ITEMS.forEach((text) => expect(screen.getAllByText(text)).toHaveLength(2));
    // 輔助技術只讀得到一份
    expect(screen.getAllByRole('listitem')).toHaveLength(ITEMS.length);
  });

  test('區塊有名稱「跑馬燈」，不是 live region（不會一直打斷報讀器）', () => {
    const { container } = render(<HomeTicker items={ITEMS} />);
    expect(screen.getByRole('region', { name: '跑馬燈' })).toBeInTheDocument();
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  test('有可見的暫停鈕，按下變成播放，再按回到暫停', async () => {
    const user = userEvent.setup();
    const { container } = render(<HomeTicker items={ITEMS} />);
    const section = container.querySelector('.home-ticker');
    expect(section).toHaveAttribute('data-paused', 'false');
    await user.click(screen.getByRole('button', { name: '暫停跑馬燈' }));
    expect(section).toHaveAttribute('data-paused', 'true');
    await user.click(screen.getByRole('button', { name: '播放跑馬燈' }));
    expect(section).toHaveAttribute('data-paused', 'false');
    expect(screen.getByRole('button', { name: '暫停跑馬燈' })).toBeInTheDocument();
  });

  test('鍵盤可以操作暫停鈕（Enter 與空白鍵）', async () => {
    const user = userEvent.setup();
    render(<HomeTicker items={ITEMS} />);
    const button = screen.getByRole('button', { name: '暫停跑馬燈' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: '播放跑馬燈' })).toHaveFocus();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: '暫停跑馬燈' })).toBeInTheDocument();
  });

  test('捲完一輪的時間有下限，用 CSS 變數交給樣式', () => {
    const { container } = render(<HomeTicker items={ITEMS} />);
    const track = container.querySelector('.home-ticker__track');
    expect(track.style.getPropertyValue('--ticker-duration')).toBe('20s');
  });

  test('一律當純文字渲染：HTML 字串不會變成元素', () => {
    const evil = '<b>粗體</b><img src=x onerror="alert(1)">';
    const { container } = render(<HomeTicker items={[evil]} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.home-ticker__copy li').textContent).toBe(evil);
  });

  test('原始碼沒有使用 dangerouslySetInnerHTML（跑馬燈、標語、引言一律純文字節點）', () => {
    expect(tickerSource).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    expect(mastheadSource).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });
});

describe('HomeTicker（使用者設定減少動態）', () => {
  test('改成靜態呈現：全部項目都讀得到、只有一份、沒有暫停鈕', () => {
    stubReducedMotion(true);
    const { container } = render(<HomeTicker items={ITEMS} />);
    expect(container.querySelector('.home-ticker')).toHaveClass('home-ticker--static');
    expect(container.querySelectorAll('.home-ticker__copy')).toHaveLength(1);
    expect(container.querySelector('.home-ticker__track')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    ITEMS.forEach((text) => expect(screen.getAllByText(text)).toHaveLength(1));
    expect(screen.getAllByRole('listitem')).toHaveLength(ITEMS.length);
  });

  test('沒有減少動態的偏好時才捲動', () => {
    stubReducedMotion(false);
    const { container } = render(<HomeTicker items={ITEMS} />);
    expect(container.querySelector('.home-ticker__track')).not.toBeNull();
    expect(screen.getByRole('button', { name: '暫停跑馬燈' })).toBeInTheDocument();
  });
});
