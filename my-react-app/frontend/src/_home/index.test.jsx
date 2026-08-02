import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './index';

// News/Calendar/FunctionBtn 各自有自己的相依（Swiper 輪播、useNavigate 等），
// 這裡只關心 App 元件怎麼撈資料、怎麼合併排序，不是這幾個子元件怎麼畫——
// mock 掉它們，直接檢查傳進去的 props，避免測試被子元件的實作細節綁住。
vi.mock('../../components/_home/news', () => ({
  default: (props) => <div data-testid="news-mock">{JSON.stringify(props)}</div>,
}));
vi.mock('../../components/_home/calendar', () => ({
  default: (props) => <div data-testid="calendar-mock">{JSON.stringify(props)}</div>,
}));
vi.mock('../../components/_home/functionBtn', () => ({
  default: (props) => <div data-testid="functionbtn-mock">{JSON.stringify(props)}</div>,
}));

function renderHome() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
}

const crawlerNewsItem = {
  title: '外部活動', detail: 'https://tacp.gov.tw/x', image: 'https://img/a.jpg',
  start_date: '2026-08-01', end_date: null, tag: '活動', isExam: 'F',
};
const crawlerExamItem = {
  title: '族語認證公告', detail: 'https://exam.sce.ntnu.edu.tw/x', image: null,
  start_date: '2026-08-05', end_date: null, tag: null, isExam: 'T',
};
const announcementItem = {
  id: 1, title: '後台公告', body: '內文', category: 'announcement', tribes: [],
  cover_image_url: 'https://img/b.jpg', link_url: 'https://x.com', is_pinned: false,
  publish_at: '2026-08-02T03:00:00Z',
};

const DEFAULT_CONFIG = {
  hero_image_url: '', hero_link_url: '', hero_title_override: '',
  show_news_section: true, show_calendar_section: true, news_display_count: 6,
  button1_enabled: true, button2_enabled: true, button3_enabled: true,
};

function mockFetchOk(newsData, announcementResults, homepageConfig = DEFAULT_CONFIG) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url.includes('/crawler/news/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(newsData) });
    }
    if (url.includes('/adminapi/public/announcements/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: announcementResults }) });
    }
    if (url.includes('/adminapi/public/homepage-config/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(homepageConfig) });
    }
    return Promise.reject(new Error(`unexpected url: ${url}`));
  }));
}

describe('首頁 · 後台公告與爬蟲消息合併顯示', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('後台公告排在爬蟲消息前面（規劃文件：後台內容永遠排在前面）', async () => {
    mockFetchOk([crawlerNewsItem, crawlerExamItem], [announcementItem]);
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      const allTitles = [...props.withImage, ...props.withoutImage].map((item) => item.title);
      expect(allTitles[0]).toBe('後台公告');
      expect(allTitles).toContain('外部活動');
    });
  });

  test('isExam=T 的爬蟲項目進 examInfo（考試時程公告），不會混進 News', async () => {
    mockFetchOk([crawlerNewsItem, crawlerExamItem], []);
    renderHome();

    await waitFor(() => {
      const calendarProps = JSON.parse(screen.getByTestId('calendar-mock').textContent);
      expect(calendarProps.examInfo).toHaveLength(1);
      expect(calendarProps.examInfo[0].title).toBe('族語認證公告');

      const newsProps = JSON.parse(screen.getByTestId('news-mock').textContent);
      const allTitles = [...newsProps.withImage, ...newsProps.withoutImage].map((item) => item.title);
      expect(allTitles).not.toContain('族語認證公告');
    });
  });

  test('公告的 link_url 對應到 News 元件用來當連結的 detail 欄位', async () => {
    mockFetchOk([], [announcementItem]);
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      const mapped = [...props.withImage, ...props.withoutImage][0];
      expect(mapped.detail).toBe('https://x.com');
      expect(mapped.image).toBe('https://img/b.jpg');
    });
  });

  test('只有其中一個來源失敗時，另一個來源的資料仍正常顯示，不觸發整體錯誤訊息', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/crawler/news/')) return Promise.reject(new Error('外部站掛了'));
      if (url.includes('/adminapi/public/announcements/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [announcementItem] }) });
      }
      if (url.includes('/adminapi/public/homepage-config/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_CONFIG) });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      const allTitles = [...props.withImage, ...props.withoutImage].map((item) => item.title);
      expect(allTitles).toContain('後台公告');
    });
    expect(screen.queryByText('目前無法載入最新消息，請稍後再試。')).not.toBeInTheDocument();
  });

  test('兩個來源都失敗時才顯示錯誤提示', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('全部掛了'))));
    renderHome();
    expect(await screen.findByText('目前無法載入最新消息，請稍後再試。')).toBeInTheDocument();
  });
});

describe('首頁 · 版位設定（HomepageConfig）套用', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('設定了 hero_image_url 時，主打卡片顯示真的圖片而不是 IMAGE PLACEHOLDER', async () => {
    mockFetchOk([], [], { ...DEFAULT_CONFIG, hero_image_url: 'https://img/hero.jpg', hero_title_override: '本週主打' });
    renderHome();

    const img = await screen.findByAltText('本週主打');
    expect(img).toHaveAttribute('src', 'https://img/hero.jpg');
    expect(screen.queryByText('IMAGE PLACEHOLDER')).not.toBeInTheDocument();
    expect(screen.getByText('本週主打')).toBeInTheDocument();
  });

  test('沒有設定 hero_image_url 時維持原本的 IMAGE PLACEHOLDER 與逐族語標題', async () => {
    mockFetchOk([], [], DEFAULT_CONFIG);
    renderHome();
    expect(await screen.findByText('IMAGE PLACEHOLDER')).toBeInTheDocument();
  });

  test('hero_link_url 是內部路徑時，主打卡片用 react-router Link 導頁', async () => {
    // 用 waitFor 重複查詢而不是單次 findByText：卡片一開始（設定還沒
    // fetch 回來前）是純 <div>，「現正主打」文字在 <div> 版跟之後的 <a>
    // 版都存在，findByText 只要找到第一個符合就會結束等待，可能剛好抓到
    // 還沒套用設定的那個版本。
    mockFetchOk([], [], { ...DEFAULT_CONFIG, hero_link_url: '/quiz/select' });
    renderHome();
    await waitFor(() => {
      const card = screen.getByText('現正主打').closest('a');
      expect(card).toHaveAttribute('href', '/quiz/select');
    });
  });

  test('hero_link_url 是外部網址時，用一般 <a target="_blank"> 開啟', async () => {
    mockFetchOk([], [], { ...DEFAULT_CONFIG, hero_link_url: 'https://example.com' });
    renderHome();
    await waitFor(() => {
      const card = screen.getByText('現正主打').closest('a');
      expect(card).toHaveAttribute('href', 'https://example.com');
      expect(card).toHaveAttribute('target', '_blank');
    });
  });

  test('show_news_section=false 時不渲染 News 元件', async () => {
    mockFetchOk([crawlerNewsItem], [], { ...DEFAULT_CONFIG, show_news_section: false });
    renderHome();
    await screen.findByTestId('calendar-mock');
    expect(screen.queryByTestId('news-mock')).not.toBeInTheDocument();
  });

  test('show_calendar_section=false 時不渲染 Calendar 元件', async () => {
    mockFetchOk([], [], { ...DEFAULT_CONFIG, show_calendar_section: false });
    renderHome();
    await screen.findByTestId('news-mock');
    expect(screen.queryByTestId('calendar-mock')).not.toBeInTheDocument();
  });

  test('news_display_count 裁切合併後清單的總筆數，不是圖文版各自裁切', async () => {
    const manyNews = Array.from({ length: 5 }, (_, i) => ({
      title: `消息${i}`, detail: '', image: i % 2 === 0 ? `https://img/${i}.jpg` : null,
      start_date: '2026-08-01', end_date: null, tag: '公告', isExam: 'F',
    }));
    mockFetchOk(manyNews, [], { ...DEFAULT_CONFIG, news_display_count: 2 });
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      expect(props.withImage.length + props.withoutImage.length).toBe(2);
    });
  });

  test('三顆功能按鈕的啟用旗標會原樣傳給 FunctionBtn', async () => {
    mockFetchOk([], [], { ...DEFAULT_CONFIG, button1_enabled: false, button2_enabled: true, button3_enabled: false });
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('functionbtn-mock').textContent);
      expect(props.enabled).toEqual({ button1: false, button2: true, button3: false });
    });
  });

  test('版位設定端點失敗時維持預設值，不影響其餘畫面渲染', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/homepage-config/')) return Promise.reject(new Error('設定端點掛了'));
      if (url.includes('/crawler/news/')) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      if (url.includes('/adminapi/public/announcements/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));
    renderHome();
    expect(await screen.findByText('IMAGE PLACEHOLDER')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-mock')).toBeInTheDocument();
  });
});
