// 輪播的暫停規則（WCAG 2.2.2）：用假的 Swiper 取得 autoplay.start／stop 的呼叫，
// 才能確定「什麼情況下輪播有沒有在跑」。真實 Swiper 的渲染由 news.test.jsx 負責。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import News from './news';

const swiperState = vi.hoisted(() => ({ instance: null, props: null }));

vi.mock('swiper/react', async () => {
  const React = await import('react');
  return {
    Swiper: (props) => {
      swiperState.props = props;
      const { onSwiper, onAutoplayStart, onAutoplayStop, children } = props;
      React.useEffect(() => {
        let running = true;
        const instance = {
          autoplay: {
            get running() { return running; },
            start: vi.fn(() => { running = true; onAutoplayStart?.(); }),
            stop: vi.fn(() => { running = false; onAutoplayStop?.(); }),
          },
        };
        swiperState.instance = instance;
        onSwiper?.(instance);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="swiper" className={props.className}>{children}</div>;
    },
    SwiperSlide: ({ children }) => <div>{children}</div>,
  };
});
vi.mock('swiper/modules', () => ({ Navigation: {}, Autoplay: {}, EffectFade: {}, A11y: {} }));
vi.mock('swiper/css', () => ({}));
vi.mock('swiper/css/effect-fade', () => ({}));
vi.mock('swiper/css/navigation', () => ({}));
vi.mock('swiper/css/a11y', () => ({}));

const item = (over) => ({ id: 1, title: '公告', start_date: '2026/10/01', end_date: null, tag: '最新消息', detail: 'https://example.org/n', image: 'https://example.org/a.webp', ...over });
const SLIDES = [item({ id: 1, title: '圖一' }), item({ id: 2, title: '圖二' })];
const TEXT = [item({ id: 3, title: '文字一', image: null })];

const stubReducedMotion = (reduced) => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

const renderNews = () => render(<News withImage={SLIDES} withoutImage={TEXT} loading={false} />);
const stage = () => document.querySelector('.event-left');
const lastCall = (fn) => fn.mock.calls.length;

// jsdom 的 :focus-visible 判斷不可靠，直接指定「這次焦點算不算鍵盤焦點」
const focusVisible = { value: true };
const realMatches = Element.prototype.matches;

beforeEach(() => {
  swiperState.instance = null;
  focusVisible.value = true;
  Element.prototype.matches = function matches(selector) {
    return selector === ':focus-visible' ? focusVisible.value : realMatches.call(this, selector);
  };
});
afterEach(() => {
  delete window.matchMedia;
  Element.prototype.matches = realMatches;
});

describe('輪播自動播放的暫停規則', () => {
  test('一開始在播放，按鈕寫「暫停自動輪播」', () => {
    renderNews();
    expect(swiperState.instance.autoplay.running).toBe(true);
    expect(screen.getByRole('button', { name: '暫停自動輪播' })).toBeInTheDocument();
  });

  test('按暫停鈕停止輪播，按鈕變成「繼續自動輪播」，再按恢復', () => {
    renderNews();
    fireEvent.click(screen.getByRole('button', { name: '暫停自動輪播' }));
    expect(swiperState.instance.autoplay.running).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '繼續自動輪播' }));
    expect(swiperState.instance.autoplay.running).toBe(true);
    expect(screen.getByRole('button', { name: '暫停自動輪播' })).toBeInTheDocument();
  });

  test('滑鼠移入暫停、移出恢復（按鈕文字跟著實際狀態）', () => {
    renderNews();
    fireEvent.pointerEnter(stage(), { pointerType: 'mouse' });
    expect(swiperState.instance.autoplay.running).toBe(false);
    expect(screen.getByRole('button', { name: '繼續自動輪播' })).toBeInTheDocument();
    fireEvent.pointerLeave(stage());
    expect(swiperState.instance.autoplay.running).toBe(true);
  });

  test('觸控與手寫筆的 pointerenter 不算 hover，不會把輪播卡住', () => {
    renderNews();
    fireEvent.pointerEnter(stage(), { pointerType: 'touch' });
    fireEvent.pointerEnter(stage(), { pointerType: 'pen' });
    expect(swiperState.instance.autoplay.running).toBe(true);
  });

  test('鍵盤焦點進到輪播內的連結就暫停，焦點離開輪播才恢復', () => {
    renderNews();
    const link = screen.getAllByRole('link')[0];
    act(() => link.focus());
    expect(swiperState.instance.autoplay.running).toBe(false);
    act(() => link.blur());
    expect(swiperState.instance.autoplay.running).toBe(true);
  });

  test('視窗失焦（blur 的 relatedTarget 是 null，但焦點仍在輪播內）不會恢復播放', () => {
    renderNews();
    const link = screen.getAllByRole('link')[0];
    act(() => link.focus());
    fireEvent.blur(link, { relatedTarget: null });
    expect(document.activeElement).toBe(link);
    expect(swiperState.instance.autoplay.running).toBe(false);
  });

  test('焦點在輪播內部移動（blur 的 relatedTarget 仍在輪播內）不會恢復', () => {
    renderNews();
    const link = screen.getAllByRole('link')[0];
    act(() => link.focus());
    fireEvent.blur(link, { relatedTarget: screen.getByRole('button', { name: /輪播/ }) });
    expect(swiperState.instance.autoplay.running).toBe(false);
  });

  test('用鍵盤 Tab 到暫停鈕也算焦點在輪播內：停下，按「繼續」後真的恢復，離開輪播再回來又會暫停', () => {
    renderNews();
    const toggle = screen.getByRole('button', { name: '暫停自動輪播' });
    act(() => toggle.focus());
    expect(swiperState.instance.autoplay.running).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '繼續自動輪播' }));
    expect(swiperState.instance.autoplay.running).toBe(true);
    expect(screen.getByRole('button', { name: '暫停自動輪播' })).toBeInTheDocument();
    act(() => toggle.blur());
    expect(swiperState.instance.autoplay.running).toBe(true);
    act(() => toggle.focus());
    expect(swiperState.instance.autoplay.running).toBe(false);
  });

  test('用滑鼠點暫停鈕（焦點不是鍵盤焦點）：點下去就是「暫停」，不會被焦點先停掉而變成「繼續」', () => {
    focusVisible.value = false;
    renderNews();
    const toggle = screen.getByRole('button', { name: '暫停自動輪播' });
    act(() => toggle.focus());
    expect(swiperState.instance.autoplay.running).toBe(true);
    fireEvent.click(toggle);
    expect(swiperState.instance.autoplay.running).toBe(false);
    expect(screen.getByRole('button', { name: '繼續自動輪播' })).toBeInTheDocument();
  });

  test('滑鼠還停在上面時按「繼續」：清掉暫停原因，輪播真的恢復，按鈕與畫面一致', () => {
    renderNews();
    fireEvent.pointerEnter(stage(), { pointerType: 'mouse' });
    expect(swiperState.instance.autoplay.running).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '繼續自動輪播' }));
    expect(swiperState.instance.autoplay.running).toBe(true);
    expect(screen.getByRole('button', { name: '暫停自動輪播' })).toBeInTheDocument();
  });

  test('使用者按過暫停後，滑鼠移入移出不會把輪播重新啟動', () => {
    renderNews();
    fireEvent.click(screen.getByRole('button', { name: '暫停自動輪播' }));
    fireEvent.pointerEnter(stage(), { pointerType: 'mouse' });
    fireEvent.pointerLeave(stage());
    expect(swiperState.instance.autoplay.running).toBe(false);
  });
});

describe('輪播設定與減少動態', () => {
  test('自動播放不靠 Swiper 內建的 hover 暫停，也不會因互動被永久關掉', () => {
    renderNews();
    const { autoplay } = swiperState.props;
    expect(autoplay.pauseOnMouseEnter).toBe(false);
    expect(autoplay.disableOnInteraction).toBe(false);
    expect(autoplay.delay).toBeGreaterThanOrEqual(5000);
  });

  test('換張速度 300ms 以內；容器與每則消息有中文的角色描述', () => {
    renderNews();
    const { speed, a11y } = swiperState.props;
    expect(speed).toBeLessThanOrEqual(300);
    expect(a11y.containerRoleDescriptionMessage).toBe('輪播');
    expect(a11y.itemRoleDescriptionMessage).toBe('消息');
    expect(a11y.prevSlideMessage).toBe('上一則消息');
    expect(a11y.nextSlideMessage).toBe('下一則消息');
  });

  test('減少動態：不自動播放、換張立即切換、沒有暫停鈕', () => {
    stubReducedMotion(true);
    renderNews();
    expect(swiperState.props.autoplay).toBe(false);
    expect(swiperState.props.speed).toBe(0);
    expect(screen.queryByRole('button', { name: /自動輪播/ })).not.toBeInTheDocument();
    expect(swiperState.instance.autoplay.start).not.toHaveBeenCalled();
  });

  test('輪播圖片是裝飾（alt 為空），標題只讀一次', () => {
    renderNews();
    document.querySelectorAll('.news-slide img').forEach((img) => expect(img).toHaveAttribute('alt', ''));
  });

  test('每則的「查看詳情」連結名稱帶標題，連結清單裡分得出是哪一則', () => {
    renderNews();
    expect(screen.getByRole('link', { name: /查看詳情.*圖一/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看詳情.*圖二/ })).toBeInTheDocument();
  });

  test('不會一直重複呼叫 start／stop：狀態沒變就不再呼叫', () => {
    renderNews();
    const before = lastCall(swiperState.instance.autoplay.start);
    fireEvent.pointerLeave(stage());
    expect(lastCall(swiperState.instance.autoplay.start)).toBe(before);
  });
});
