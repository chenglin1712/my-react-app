import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import HomePromoVideo from './PromoVideo';
import { formatClock, pickPromoVideo, safeMediaUrl } from './promoVideoContent';
import promoSource from './PromoVideo.jsx?raw';

const RAW = {
  id: 3, title: '認識原語', description: '三分鐘看懂平台。', transcript: '第一行\n第二行',
  video_url: '/media/homepage/video/a.mp4', cover_url: '/media/homepage/cover/a.webp',
  caption_url: '/media/homepage/caption/a.vtt', duration_seconds: 412, available: true,
};

let observers;
const pausedState = new WeakMap();

const stubReducedMotion = (reduced) => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

beforeEach(() => {
  observers = [];
  window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return pausedState.get(this) ?? true; } });
  HTMLMediaElement.prototype.play = vi.fn(function play() {
    pausedState.set(this, false);
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  HTMLMediaElement.prototype.pause = vi.fn(function pause() {
    pausedState.set(this, true);
    this.dispatchEvent(new Event('pause'));
  });
});

afterEach(() => {
  delete window.matchMedia;
  delete window.IntersectionObserver;
});

const setView = (inView) => act(() => { observers.forEach((o) => o.callback([{ isIntersecting: inView }])); });
const renderVideo = (raw = RAW) => render(<HomePromoVideo video={pickPromoVideo(raw)} />);
const getVideo = (container) => container.querySelector('video');

describe('進入畫面才載入', () => {
  test('還沒進入畫面：只有封面與播放鈕，沒有 <video>，不下載影片', () => {
    const { container } = renderVideo();
    expect(getVideo(container)).toBeNull();
    expect(container.querySelector('.home-promo__cover')).toHaveAttribute('src', RAW.cover_url);
    expect(screen.getByRole('button', { name: '播放宣傳影片' })).toBeInTheDocument();
  });

  test('進入畫面後載入並靜音自動播放，帶封面，播放時按鈕顯示「暫停」', () => {
    const { container } = renderVideo();
    setView(true);
    const video = getVideo(container);
    expect(video).toHaveAttribute('src', RAW.video_url);
    expect(video).toHaveAttribute('poster', RAW.cover_url);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    fireEvent.play(video);
    expect(screen.getByRole('button', { name: /暫停/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /開啟聲音/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '播放宣傳影片' })).not.toBeInTheDocument();
  });

  test('離開畫面自動暫停，回到畫面自動續播', () => {
    const { container } = renderVideo();
    setView(true);
    const video = getVideo(container);
    fireEvent.play(video);
    pausedState.set(video, false);
    setView(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    HTMLMediaElement.prototype.play.mockClear();
    setView(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  test('使用者自己按過暫停：離開再回來不會自動續播', () => {
    const { container } = renderVideo();
    setView(true);
    const video = getVideo(container);
    fireEvent.play(video);
    pausedState.set(video, false);
    fireEvent.click(screen.getByRole('button', { name: /暫停/ }));
    expect(screen.getByRole('button', { name: /^播放$/ })).toBeInTheDocument();
    setView(false);
    HTMLMediaElement.prototype.play.mockClear();
    setView(true);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  test('瀏覽器沒有 IntersectionObserver 時直接載入（退路）', () => {
    delete window.IntersectionObserver;
    const { container } = renderVideo();
    expect(getVideo(container)).not.toBeNull();
  });
});

describe('播放時機的邊界情況', () => {
  test('掛載完成前就離開畫面：video 掛上去後不會在畫面外自動播放', () => {
    const { container } = renderVideo();
    act(() => {
      observers.forEach((o) => o.callback([{ isIntersecting: true }]));
      observers.forEach((o) => o.callback([{ isIntersecting: false }]));
    });
    expect(getVideo(container)).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    setView(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  test('播完之後離開再回到畫面，不會自己從頭重播；按播放才會', () => {
    const { container } = renderVideo();
    setView(true);
    const video = getVideo(container);
    fireEvent.play(video);
    pausedState.set(video, true);
    fireEvent.ended(video);
    setView(false);
    HTMLMediaElement.prototype.play.mockClear();
    setView(true);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^播放$/ }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  test('瀏覽器擋下自動播放（NotAllowedError）不算故障：停在暫停，有播放鈕', async () => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })));
    const { container } = renderVideo();
    setView(true);
    await act(async () => {});
    expect(getVideo(container)).not.toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^播放$/ })).toBeInTheDocument();
  });

  test('格式不支援（NotSupportedError）才進入無法播放', async () => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.reject(Object.assign(new Error('nope'), { name: 'NotSupportedError' })));
    renderVideo();
    setView(true);
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('影片目前無法播放。');
  });
});

describe('聲音、進度與字幕', () => {
  test('「開啟聲音」切換成「關閉聲音」並真的取消靜音，再按回去', () => {
    const { container } = renderVideo();
    setView(true);
    const video = getVideo(container);
    fireEvent.click(screen.getByRole('button', { name: /開啟聲音/ }));
    expect(video.muted).toBe(false);
    const off = screen.getByRole('button', { name: /關閉聲音/ });
    expect(off).not.toHaveAttribute('aria-pressed');
    fireEvent.click(off);
    expect(video.muted).toBe(true);
    expect(screen.getByRole('button', { name: /開啟聲音/ })).toBeInTheDocument();
  });

  test('進度條可拖曳跳轉，有名稱與文字值；時間用 m:ss', () => {
    const { container } = renderVideo();
    setView(true);
    const video = getVideo(container);
    const seek = screen.getByRole('slider', { name: '播放進度' });
    expect(seek).toHaveAttribute('max', '412');
    expect(seek).toHaveAttribute('aria-valuetext', '0:00 / 6:52');
    fireEvent.change(seek, { target: { value: '65' } });
    expect(video.currentTime).toBe(65);
    expect(screen.getByRole('slider', { name: '播放進度' })).toHaveAttribute('aria-valuetext', '1:05 / 6:52');
  });

  test('有字幕檔才掛字幕軌，預設開啟（靜音播放時看得懂）', () => {
    const { container, unmount } = renderVideo();
    setView(true);
    const track = container.querySelector('track');
    expect(track).toHaveAttribute('kind', 'captions');
    expect(track).toHaveAttribute('src', RAW.caption_url);
    expect(track).toHaveAttribute('srclang', 'zh-Hant');
    expect(track.default).toBe(true);
    unmount();
    const second = renderVideo({ ...RAW, caption_url: null });
    setView(true);
    expect(second.container.querySelector('track')).toBeNull();
  });
});

describe('減少動態', () => {
  test('進入畫面也不自動載入、不自動播放，只有封面與播放鈕', () => {
    stubReducedMotion(true);
    const { container } = renderVideo();
    setView(true);
    expect(getVideo(container)).toBeNull();
    expect(screen.getByRole('button', { name: '播放宣傳影片' })).toBeInTheDocument();
  });

  test('按下播放鈕才載入，並帶聲音播放（使用者主動操作）', () => {
    stubReducedMotion(true);
    const { container } = renderVideo();
    fireEvent.click(screen.getByRole('button', { name: '播放宣傳影片' }));
    const video = getVideo(container);
    expect(video).not.toBeNull();
    expect(video.muted).toBe(false);
    expect(screen.getByRole('button', { name: /關閉聲音/ })).toBeInTheDocument();
  });
});

describe('失敗與缺檔', () => {
  test('播放失敗：留著封面，顯示文字說明、重試鈕與展開的逐字稿，不再有播放器', () => {
    const { container } = renderVideo();
    setView(true);
    fireEvent.error(getVideo(container));
    expect(getVideo(container)).toBeNull();
    expect(container.querySelector('.home-promo__cover')).toHaveAttribute('src', RAW.cover_url);
    expect(screen.getByRole('status')).toHaveTextContent('影片目前無法播放。');
    expect(screen.getByRole('button', { name: '重試' })).toBeInTheDocument();
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(container.querySelector('details p').textContent).toBe('第一行\n第二行');
  });

  test('重試會重新建立播放器', () => {
    const { container } = renderVideo();
    setView(true);
    fireEvent.error(getVideo(container));
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(getVideo(container)).not.toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('available 為 false：直接進入無法播放，不載入影片，沒有重試鈕但有逐字稿', () => {
    const { container } = renderVideo({ ...RAW, available: false, video_url: null });
    setView(true);
    expect(getVideo(container)).toBeNull();
    expect(container.querySelector('.home-promo__cover')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('影片目前無法播放。');
    expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '播放宣傳影片' })).not.toBeInTheDocument();
    expect(container.querySelector('details')).toHaveAttribute('open');
  });

  test('沒有封面也沒有逐字稿：不放破圖、不放空的逐字稿區', () => {
    const { container } = renderVideo({ ...RAW, cover_url: null, transcript: '', available: false, video_url: null });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });
});

describe('文字與安全', () => {
  test('標題與說明在播放器下方，標題是 h2', () => {
    renderVideo();
    expect(screen.getByRole('heading', { level: 2, name: '認識原語' })).toBeInTheDocument();
    expect(screen.getByText('三分鐘看懂平台。')).toBeInTheDocument();
  });

  test('標題、說明、逐字稿都當純文字，HTML 不會變成元素', () => {
    const evil = '<img src=x onerror="alert(1)"><b>粗體</b>';
    const { container } = renderVideo({ ...RAW, title: evil, description: evil, transcript: evil });
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelectorAll('img').length).toBe(1); // 只有封面
    expect(container.querySelector('.home-promo__title').textContent).toBe(evil);
    expect(container.querySelector('details p').textContent).toBe(evil);
  });

  test('原始碼沒有使用 dangerouslySetInnerHTML', () => {
    expect(promoSource).not.toMatch(/dangerouslySetInnerHTML\s*=/);
  });
});

describe('pickPromoVideo', () => {
  test('沒有影片：null、非物件、陣列都回 null', () => {
    [null, undefined, '', 5, [], 'x'].forEach((v) => expect(pickPromoVideo(v)).toBeNull());
  });

  test('一般資料：欄位整理成前台格式', () => {
    expect(pickPromoVideo(RAW)).toEqual({
      id: 3, title: '認識原語', description: '三分鐘看懂平台。', transcript: '第一行\n第二行',
      videoUrl: RAW.video_url, coverUrl: RAW.cover_url, captionUrl: RAW.caption_url, durationSeconds: 412, playable: true,
    });
  });

  test('缺檔仍保留物件（要顯示封面、說明與逐字稿），但不可播放', () => {
    const v = pickPromoVideo({ ...RAW, available: false, video_url: null });
    expect(v).not.toBeNull();
    expect(v.playable).toBe(false);
    expect(v.coverUrl).toBe(RAW.cover_url);
  });

  test('available 為 true 但網址被竄改成外部網址：視為不可播放', () => {
    ['https://evil.example/a.mp4', '//evil.example/a.mp4', 'javascript:alert(1)', '/a\\b.mp4', 5].forEach((url) => {
      const v = pickPromoVideo({ ...RAW, video_url: url, cover_url: url, caption_url: url });
      expect(v.playable, String(url)).toBe(false);
      expect(v.coverUrl).toBeNull();
      expect(v.captionUrl).toBeNull();
    });
  });

  test('長度不合理時當作未知', () => {
    [-1, 0, NaN, 'abc', null].forEach((d) => expect(pickPromoVideo({ ...RAW, duration_seconds: d }).durationSeconds).toBe(0));
  });

  test('safeMediaUrl 與 formatClock', () => {
    expect(safeMediaUrl('/media/x.mp4')).toBe('/media/x.mp4');
    expect(safeMediaUrl('media/x.mp4')).toBeNull();
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(412)).toBe('6:52');
    expect(formatClock(NaN)).toBe('0:00');
    expect(formatClock(-3)).toBe('0:00');
  });
});
