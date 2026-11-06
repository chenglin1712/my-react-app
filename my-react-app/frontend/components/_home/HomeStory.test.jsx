import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import HomeStory from './HomeStory';
import { STORY_STEPS } from './storyContent';
import { STORY_TOP, storyProgress, stepForProgress } from './storyMath';

describe('storyProgress / stepForProgress', () => {
  test('區塊剛好釘住時進度 0；捲完釘住的那一段進度 1；超出範圍會夾住', () => {
    // 區塊高 2400、舞台高 600：可捲的距離 = 2400 - 600 - 80
    const base = { sectionHeight: 2400, stageHeight: 600 };
    expect(storyProgress({ ...base, sectionTop: STORY_TOP })).toBe(0);
    expect(storyProgress({ ...base, sectionTop: STORY_TOP - (2400 - 600 - STORY_TOP) })).toBe(1);
    expect(storyProgress({ ...base, sectionTop: 500 })).toBe(0);
    expect(storyProgress({ ...base, sectionTop: -9999 })).toBe(1);
  });

  test('進度四等分對應第幾步，邊界與超界都不會跑出 0～3', () => {
    expect([0, 0.24, 0.25, 0.49, 0.5, 0.74, 0.75, 0.99, 1].map((p) => stepForProgress(p))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3]);
    expect(stepForProgress(-1)).toBe(0);
    expect(stepForProgress(5)).toBe(3);
  });

  test('區塊高度比舞台還小時不會除以零', () => {
    expect(Number.isFinite(storyProgress({ sectionTop: 0, sectionHeight: 100, stageHeight: 600 }))).toBe(true);
  });
});

describe('HomeStory 內容（對照首頁設計稿）', () => {
  beforeEach(() => {
    // jsdom 沒有版面：讓區塊的位置固定在「剛好釘住」（進度 0），舞台高 600
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: STORY_TOP, height: 2400 });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    window.requestAnimationFrame = (cb) => { cb(0); return 1; };
    window.cancelAnimationFrame = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  test('標題、四步文字、提示與略過連結都在畫面上（沒有任何一步被藏起來）', () => {
    render(<HomeStory />);
    expect(screen.getByRole('region', { name: '一個詞的旅程' })).toBeInTheDocument();
    expect(screen.getAllByText('一個詞的旅程').length).toBeGreaterThan(0);
    expect(STORY_STEPS.map((s) => s.title)).toEqual(['查一個詞', '拍下身邊的物件', '用遊戲記住它', '測出卡在哪裡']);
    expect(STORY_STEPS.map((s) => s.glyph)).toEqual(['遇見', '看見', '記住', '回家']);
    STORY_STEPS.forEach((s) => {
      expect(screen.getByText(s.title)).toBeInTheDocument();
      expect(screen.getByText(s.text)).toBeInTheDocument();
    });
    expect(screen.getByText('繼續往下捲動')).toBeInTheDocument();
  });

  test('四步是有序清單；編號與大字、進度條、提示是裝飾，報讀器不唸', () => {
    const { container } = render(<HomeStory />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    container.querySelectorAll('.home-story__num, .home-story__art, .home-story__cue').forEach((el) => expect(el).toHaveAttribute('aria-hidden', 'true'));
  });

  test('一開始是第一步：第一步展開、第一層圖樣在、大字是「遇見」', () => {
    const { container } = render(<HomeStory />);
    const items = container.querySelectorAll('.home-story__step');
    expect(items[0]).toHaveClass('is-on');
    expect(container.querySelectorAll('.home-story__step.is-on')).toHaveLength(1);
    expect(container.querySelectorAll('.home-story__layer.is-on')).toHaveLength(1);
    expect(container.querySelector('.home-story__glyph')).toHaveTextContent('遇見');
  });

  test('略過連結指向下一個區段，預設是 #home-topics，也可以換', () => {
    const a = render(<HomeStory />);
    expect(screen.getByRole('link', { name: '略過這一段 →' })).toHaveAttribute('href', '#home-topics');
    a.unmount();
    render(<HomeStory skipTo="#x" />);
    expect(screen.getByRole('link', { name: '略過這一段 →' })).toHaveAttribute('href', '#x');
  });

  test('捲動到第三步：第三步展開、前三層圖樣都蓋上、大字換成「記住」', async () => {
    vi.useFakeTimers();
    const { container } = render(<HomeStory />);
    const section = container.querySelector('.home-story');
    const stage = container.querySelector('.home-story__stage');
    // 可捲距離 = 2400 - 600 - 80 = 1720；進度 0.55 → 第三步
    section.getBoundingClientRect = () => ({ top: STORY_TOP - 0.55 * 1720, height: 2400 });
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    // 假計時器也會接管 requestAnimationFrame：先推一格讓捲動計算跑完並重繪，再推過換字的 180ms
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    const items = container.querySelectorAll('.home-story__step');
    expect(items[2]).toHaveClass('is-on');
    expect(container.querySelectorAll('.home-story__step.is-on')).toHaveLength(1);
    expect(container.querySelectorAll('.home-story__layer.is-on')).toHaveLength(3);
    expect(container.querySelector('.home-story__glyph')).toHaveTextContent('記住');
    // 進度條用 CSS 變數：0.55 * 4 = 2.2
    expect(stage.style.getPropertyValue('--story-f')).toBe('2.200');
    vi.useRealTimers();
  });

  test('窄螢幕（不符合 min-width: 821px）不依捲動換步', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container } = render(<HomeStory />);
    const section = container.querySelector('.home-story');
    section.getBoundingClientRect = () => ({ top: -5000, height: 2400 });
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    expect(container.querySelectorAll('.home-story__step')[0]).toHaveClass('is-on');
  });

  test('卸載時移除捲動與縮放監聽', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<HomeStory />);
    unmount();
    expect(remove.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['scroll', 'resize']));
  });
});
