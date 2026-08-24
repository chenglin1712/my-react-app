import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './index';

// News/Calendar/FunctionBtn 各自有自己的相依（Swiper 輪播、useNavigate 等），
// 這裡只關心 App 元件怎麼撈資料、怎麼依分類分流，不是這幾個子元件怎麼畫——
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
      <HomePage />
    </MemoryRouter>,
  );
}

// 首頁現在只讀 /adminapi/public/announcements/ 一個來源（含後台自建與
// 爬蟲匯入兩種，前端無從分辨也不需要分辨）——這裡的 fixture 涵蓋一般公告、
// 活動（帶 source_tag／display_date_text，模擬爬蟲匯入）、考試三種分類。
const announcementItem = {
  id: 1, title: '後台公告', body: '內文', category: 'announcement', tribes: [],
  cover_image_url: 'https://img/b.jpg', link_url: 'https://x.com', is_pinned: false,
  publish_at: '2026-08-02T03:00:00Z', display_date_text: '', source_tag: '',
};
const activityAnnouncementItem = {
  id: 2, title: '外部活動', body: '', category: 'activity', tribes: [],
  cover_image_url: 'https://img/a.jpg', link_url: 'https://tacp.gov.tw/x', is_pinned: false,
  publish_at: '2026-08-01T00:00:00Z', display_date_text: '2026-08-01 ~ 2026-08-10', source_tag: '最新消息',
};
const examAnnouncementItem = {
  id: 3, title: '族語認證公告', body: '', category: 'exam', tribes: [],
  cover_image_url: '', link_url: 'https://exam.sce.ntnu.edu.tw/x', is_pinned: false,
  publish_at: '2026-08-05T00:00:00Z', display_date_text: '115年8月5日', source_tag: '',
};

const DEFAULT_CONFIG = {
  hero_image_url: '', hero_link_url: '', hero_title_override: '',
  show_news_section: true, show_calendar_section: true, news_display_count: 6,
  button1_enabled: true, button2_enabled: true, button3_enabled: true,
};

function mockFetchOk(announcementResults, homepageConfig = DEFAULT_CONFIG) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url.includes('/adminapi/public/announcements/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: announcementResults }) });
    }
    if (url.includes('/adminapi/public/homepage-config/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(homepageConfig) });
    }
    return Promise.reject(new Error(`unexpected url: ${url}`));
  }));
}

describe('首頁 · 後台公告（單一來源，含爬蟲匯入內容）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('category=exam 的公告進 Calendar 的族語認證公告區塊，不會混進 News', async () => {
    mockFetchOk([announcementItem, examAnnouncementItem]);
    renderHome();

    await waitFor(() => {
      const calendarProps = JSON.parse(screen.getByTestId('calendar-mock').textContent);
      expect(calendarProps.examInfo).toHaveLength(1);
      expect(calendarProps.examInfo[0].title).toBe('族語認證公告');

      const newsProps = JSON.parse(screen.getByTestId('news-mock').textContent);
      const allTitles = [...newsProps.withImage, ...newsProps.withoutImage].map((item) => item.title);
      expect(allTitles).not.toContain('族語認證公告');
      expect(allTitles).toContain('後台公告');
    });
  });

  test('公告的 link_url／cover_image_url 對應到 News 元件的 detail／image 欄位', async () => {
    mockFetchOk([announcementItem]);
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      const mapped = [...props.withImage, ...props.withoutImage][0];
      expect(mapped.detail).toBe('https://x.com');
      expect(mapped.image).toBe('https://img/b.jpg');
    });
  });

  test('有 display_date_text（爬蟲匯入內容）時優先顯示它，不是格式化的 publish_at', async () => {
    mockFetchOk([activityAnnouncementItem]);
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      const mapped = [...props.withImage, ...props.withoutImage][0];
      expect(mapped.start_date).toBe('2026-08-01 ~ 2026-08-10');
    });
  });

  test('沒有 display_date_text（後台自建公告）時退回格式化的 publish_at', async () => {
    mockFetchOk([announcementItem]);
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      const mapped = [...props.withImage, ...props.withoutImage][0];
      expect(mapped.start_date).not.toBe('');
      expect(mapped.start_date).not.toBe('2026-08-01 ~ 2026-08-10');
    });
  });

  test('有 source_tag（爬蟲原始分類文字）時優先顯示它，不是固定的 4 分類標籤', async () => {
    mockFetchOk([activityAnnouncementItem]);
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      const mapped = [...props.withImage, ...props.withoutImage][0];
      expect(mapped.tag).toBe('最新消息');
    });
  });

  test('沒有 source_tag（後台自建公告）時退回固定分類標籤', async () => {
    mockFetchOk([announcementItem]);
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      const mapped = [...props.withImage, ...props.withoutImage][0];
      expect(mapped.tag).toBe('公告');
    });
  });

  test('公告端點失敗時顯示錯誤提示', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/announcements/')) return Promise.reject(new Error('掛了'));
      if (url.includes('/adminapi/public/homepage-config/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_CONFIG) });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));
    renderHome();
    expect(await screen.findByText('目前無法載入最新消息，請稍後再試。')).toBeInTheDocument();
  });
});

describe('首頁 · 版位設定（HomepageConfig）套用', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('設定了 hero_image_url 時，主打卡片顯示真的圖片而不是 IMAGE PLACEHOLDER', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, hero_image_url: 'https://img/hero.jpg', hero_title_override: '本週主打' });
    renderHome();

    const img = await screen.findByAltText('本週主打');
    expect(img).toHaveAttribute('src', 'https://img/hero.jpg');
    expect(screen.queryByText('IMAGE PLACEHOLDER')).not.toBeInTheDocument();
    expect(screen.getByText('本週主打')).toBeInTheDocument();
  });

  test('沒有設定 hero_image_url 時維持原本的 IMAGE PLACEHOLDER 與逐族語標題', async () => {
    mockFetchOk([], DEFAULT_CONFIG);
    renderHome();
    expect(await screen.findByText('IMAGE PLACEHOLDER')).toBeInTheDocument();
  });

  test('hero_link_url 是內部路徑時，主打卡片用 react-router Link 導頁', async () => {
    // 用 waitFor 重複查詢而不是單次 findByText：卡片一開始（設定還沒
    // fetch 回來前）是純 <div>，「現正主打」文字在 <div> 版跟之後的 <a>
    // 版都存在，findByText 只要找到第一個符合就會結束等待，可能剛好抓到
    // 還沒套用設定的那個版本。
    mockFetchOk([], { ...DEFAULT_CONFIG, hero_link_url: '/quiz/select' });
    renderHome();
    await waitFor(() => {
      const card = screen.getByText('現正主打').closest('a');
      expect(card).toHaveAttribute('href', '/quiz/select');
    });
  });

  test('hero_link_url 是外部網址時，用一般 <a target="_blank"> 開啟', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, hero_link_url: 'https://example.com' });
    renderHome();
    await waitFor(() => {
      const card = screen.getByText('現正主打').closest('a');
      expect(card).toHaveAttribute('href', 'https://example.com');
      expect(card).toHaveAttribute('target', '_blank');
    });
  });

  test('show_news_section=false 時不渲染 News 元件', async () => {
    mockFetchOk([activityAnnouncementItem], { ...DEFAULT_CONFIG, show_news_section: false });
    renderHome();
    await screen.findByTestId('calendar-mock');
    expect(screen.queryByTestId('news-mock')).not.toBeInTheDocument();
  });

  test('show_calendar_section=false 時不渲染 Calendar 元件', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, show_calendar_section: false });
    renderHome();
    await screen.findByTestId('news-mock');
    expect(screen.queryByTestId('calendar-mock')).not.toBeInTheDocument();
  });

  test('news_display_count 裁切清單的總筆數，不是圖文版各自裁切', async () => {
    const manyNews = Array.from({ length: 5 }, (_, i) => ({
      id: i, title: `消息${i}`, body: '', category: 'announcement', tribes: [],
      cover_image_url: i % 2 === 0 ? `https://img/${i}.jpg` : '', link_url: '', is_pinned: false,
      publish_at: '2026-08-01T00:00:00Z', display_date_text: '', source_tag: '',
    }));
    mockFetchOk(manyNews, { ...DEFAULT_CONFIG, news_display_count: 2 });
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('news-mock').textContent);
      expect(props.withImage.length + props.withoutImage.length).toBe(2);
    });
  });

  test('三顆功能按鈕的啟用旗標會原樣傳給 FunctionBtn', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, button1_enabled: false, button2_enabled: true, button3_enabled: false });
    renderHome();

    await waitFor(() => {
      const props = JSON.parse(screen.getByTestId('functionbtn-mock').textContent);
      expect(props.enabled).toEqual({ button1: false, button2: true, button3: false });
    });
  });

  test('版位設定端點失敗時維持預設值，不影響其餘畫面渲染', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/homepage-config/')) return Promise.reject(new Error('設定端點掛了'));
      if (url.includes('/adminapi/public/announcements/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));
    renderHome();
    expect(await screen.findByText('IMAGE PLACEHOLDER')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-mock')).toBeInTheDocument();
  });

  test('版位設定端點回傳的資料缺欄位時，缺的那個欄位退回預設值，而不是變成 undefined', async () => {
    // 回歸測試：原本 setHomepageConfig(data) 整包覆蓋、沒跟 DEFAULT_HOMEPAGE_CONFIG
    // merge，後端漏帶某個欄位時那個欄位會直接變成 undefined。
    mockFetchOk([], { show_news_section: false });
    renderHome();

    await waitFor(() => {
      // show_news_section 明確被後端設為 false 時尊重後端值：News 不渲染。
      expect(screen.queryByTestId('news-mock')).not.toBeInTheDocument();
      // show_calendar_section 後端沒有回傳，應該退回預設值 true，而不是 undefined。
      expect(screen.getByTestId('calendar-mock')).toBeInTheDocument();
    });
  });
});

describe('首頁 · 族語切換', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('族語列表是可鍵盤操作的按鈕，點擊後套用 aria-pressed 與族語羅馬拼音', async () => {
    mockFetchOk([]);
    renderHome();
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());

    const tayalButton = screen.getByRole('button', { name: /泰雅/ });
    expect(tayalButton).toHaveAttribute('aria-pressed', 'true');

    const amisButton = screen.getByRole('button', { name: /阿美/ });
    expect(amisButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(amisButton);

    expect(amisButton).toHaveAttribute('aria-pressed', 'true');
    expect(tayalButton).toHaveAttribute('aria-pressed', 'false');
  });
});
