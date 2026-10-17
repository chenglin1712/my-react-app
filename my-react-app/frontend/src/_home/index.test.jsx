import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './index';

const authState = vi.hoisted(() => ({ current: { userData: null, loading: false } }));
vi.mock('../userServives/authContext', () => ({ useAuth: () => authState.current }));
beforeEach(() => {
  authState.current = { userData: null, loading: false };
});

// News/Calendar/FunctionBtn 各自有自己的相依（Swiper 輪播、useNavigate 等），
// 這裡只關心 App 元件怎麼撈資料、怎麼依分類分流，不是這幾個子元件怎麼畫——
// mock 掉它們，直接檢查傳進去的 props，避免測試被子元件的實作細節綁住。
vi.mock('../../components/_home/news', () => ({
  default: (props) => <div data-testid="news-mock">{JSON.stringify(props)}</div>,
}));
vi.mock('../../components/_home/calendar', () => ({
  default: (props) => <div data-testid="calendar-mock">{JSON.stringify(props)}</div>,
}));
vi.mock('../../components/_home/dateReminder', () => ({
  default: () => <div data-testid="datereminder-mock" />,
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

  test('設定了 hero_image_url 時，主打卡片顯示真的圖片而不是預設圖', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, hero_image_url: 'https://img/hero.jpg', hero_title_override: '本週主打' });
    renderHome();

    expect(await screen.findByText('現正主打')).toBeInTheDocument();
    const img = document.querySelector('.home-feature-image img');
    expect(img).toHaveAttribute('src', 'https://img/hero.jpg');
    // 標題已經在卡片上，圖片是同一內容的主視覺：alt 留空，報讀器不重複唸
    expect(img).toHaveAttribute('alt', '');
    expect(screen.getByRole('heading', { level: 3, name: '本週主打' })).toBeInTheDocument();
    expect(document.querySelector('.home-feature-image span')).toBeNull();
    expect(screen.getByText('本週主打')).toBeInTheDocument();
  });

  test('沒有設定 hero_image_url 時顯示族語預設圖（不再出現英文 placeholder 字樣）與逐族語標題', async () => {
    mockFetchOk([], DEFAULT_CONFIG);
    renderHome();
    // 沒有後台設定時不假裝有「現正主打」：標題就是目前選的族語名稱，不再自動湊「X語主題週」
    expect(await screen.findByText('泰雅語')).toBeInTheDocument();
    expect(screen.queryByText('現正主打')).not.toBeInTheDocument();
    expect(screen.queryByText('泰雅語主題週')).not.toBeInTheDocument();
    expect(document.querySelector('.home-feature-image span')).toHaveTextContent('Tayal');
    expect(screen.queryByText('IMAGE PLACEHOLDER')).not.toBeInTheDocument();
  });

  test('hero_image_url 的圖載入失敗時退回預設圖，不顯示破圖', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, hero_image_url: 'https://img/broken.jpg', hero_title_override: '本週主打' });
    renderHome();
    await waitFor(() => expect(document.querySelector('.home-feature-image img')).not.toBeNull());
    fireEvent.error(document.querySelector('.home-feature-image img'));
    await waitFor(() => expect(document.querySelector('.home-feature-image img')).toBeNull());
    // 後台有設定標題的主打卡不隨族語變：圖壞掉退回純圖樣，不顯示族語羅馬拼音
    expect(document.querySelector('.home-feature-image span')).toBeNull();
  });

  test('hero_link_url 是內部路徑時，主打卡片用 react-router Link 導頁', async () => {
    // 用 waitFor 重複查詢而不是單次 findByText：卡片一開始（設定還沒
    // fetch 回來前）是純 <div>，「現正主打」文字在 <div> 版跟之後的 <a>
    // 版都存在，findByText 只要找到第一個符合就會結束等待，可能剛好抓到
    // 還沒套用設定的那個版本。
    mockFetchOk([], { ...DEFAULT_CONFIG, hero_link_url: '/quiz/select', hero_title_override: '本週主打' });
    renderHome();
    await waitFor(() => {
      const card = screen.getByText('現正主打').closest('a');
      expect(card).toHaveAttribute('href', '/quiz/select');
    });
  });

  test('hero_link_url 是外部網址時，用一般 <a target="_blank"> 開啟', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, hero_link_url: 'https://example.com', hero_title_override: '本週主打' });
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
    expect(await screen.findByText('泰雅語')).toBeInTheDocument();
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

  test('訪客看到免費註冊按鈕，並把 isGuest 傳給功能卡', async () => {
    mockFetchOk([]);
    renderHome();
    expect(screen.getByRole('link', { name: '免費註冊' })).toHaveAttribute('href', '/register');
    expect(JSON.parse((await screen.findByTestId('functionbtn-mock')).textContent).isGuest).toBe(true);
  });

  test('已登入不顯示免費註冊按鈕，功能卡也不標會員', async () => {
    authState.current = { userData: { uid: 'u1' }, loading: false };
    mockFetchOk([]);
    renderHome();
    expect(screen.queryByRole('link', { name: '免費註冊' })).not.toBeInTheDocument();
    expect(JSON.parse((await screen.findByTestId('functionbtn-mock')).textContent).isGuest).toBe(false);
  });

  test('登入狀態還在確認時先不顯示註冊按鈕（避免已登入的人看到閃一下）', async () => {
    authState.current = { userData: null, loading: true };
    mockFetchOk([]);
    renderHome();
    expect(screen.queryByRole('link', { name: '免費註冊' })).not.toBeInTheDocument();
  });

  test('已移除假終端機與多餘的 hero 裝飾', async () => {
    mockFetchOk([]);
    renderHome();
    expect(document.querySelector('.home-console')).toBeNull();
    expect(document.querySelectorAll('.home-streak, .home-sprite, .home-diamond-glyph')).toHaveLength(0);
  });

  test('消息載入失敗時只顯示錯誤說明，不渲染空的 News 區塊', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/homepage-config/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_CONFIG) });
      }
      return Promise.resolve({ ok: false, status: 500 });
    }));
    renderHome();
    expect(await screen.findByText('目前無法載入最新消息，請稍後再試。')).toBeInTheDocument();
    expect(screen.queryByTestId('news-mock')).not.toBeInTheDocument();
  });

  test('只設了連結、沒設標題時，卡片仍算主打：不顯示隨族語變的標題與羅馬拼音', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, hero_link_url: '/quiz/select' });
    renderHome();
    await waitFor(() => expect(screen.getByText('現正主打').closest('a')).toHaveAttribute('href', '/quiz/select'));
    expect(screen.queryByText('語言預覽')).not.toBeInTheDocument();
    expect(document.querySelector('.home-feature-title')).toBeNull();
    expect(document.querySelector('.home-feature-sub')).toBeNull();
  });

  test('「五族語言」是 h2，登入狀態確認期間註冊按鈕只佔位、不是連結', async () => {
    authState.current = { userData: null, loading: true };
    mockFetchOk([]);
    renderHome();
    expect(screen.getByRole('heading', { level: 2, name: /五族語言/ })).toBeInTheDocument();
    expect(document.querySelector('.home-cta-placeholder')).not.toBeNull();
    expect(screen.queryByRole('link', { name: '免費註冊' })).not.toBeInTheDocument();
  });
});

describe('首頁 · 報頭與跑馬燈（S6-1，讀後台公開設定）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const MASTHEAD_CONFIG = {
    ...DEFAULT_CONFIG,
    marquee_items: ['跑馬燈第一則', '跑馬燈第二則'], show_marquee: true,
    tagline: '讓語言回家', show_tagline: true,
    quote_text: '每一種語言，都是一座回得去的家。', show_quote: true,
  };

  test('設定載入前與後台從沒填過：只有固定的「原語」「YUAN・YU」，沒有跑馬燈、標語、引言', async () => {
    mockFetchOk([]);
    renderHome();
    // 載入前（預設值）
    expect(screen.getByText('原語')).toBeInTheDocument();
    expect(screen.getByText('YUAN・YU', { selector: '.home-mast__en-name' })).toBeInTheDocument();
    expect(document.querySelector('.home-ticker')).toBeNull();
    expect(document.querySelector('.home-mast__quote')).toBeNull();
    expect(document.querySelector('.home-mast__tagline')).toBeNull();
    // 載入後（後端回的也是空）
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    expect(document.querySelector('.home-ticker')).toBeNull();
    expect(document.querySelector('.home-mast__quote')).toBeNull();
  });

  test('後台填了之後：跑馬燈、標語、引言都出現，並在報頭與跑馬燈區塊裡', async () => {
    mockFetchOk([], MASTHEAD_CONFIG);
    renderHome();
    expect(await screen.findByRole('region', { name: '跑馬燈' })).toBeInTheDocument();
    expect(screen.getAllByText('跑馬燈第一則').length).toBeGreaterThan(0);
    expect(document.querySelector('.home-mast__quote')).toHaveTextContent('每一種語言，都是一座回得去的家。');
    expect(document.querySelector('.home-mast__tagline')).toHaveTextContent('讓語言回家');
  });

  test('跑馬燈在報頭之前、兩者都在首頁最上方（第一屏區塊之前）', async () => {
    mockFetchOk([], MASTHEAD_CONFIG);
    renderHome();
    await screen.findByRole('region', { name: '跑馬燈' });
    const page = document.querySelector('.homepage');
    const order = [...page.children].map((el) => el.className);
    expect(order[0]).toContain('home-ticker');
    expect(order[1]).toContain('home-mast');
    expect(order[2]).toContain('home-first');
    expect(order[3]).toContain('home-hero');
  });

  test('開關關閉時不輸出（即使資料裡還有內容）', async () => {
    mockFetchOk([], { ...MASTHEAD_CONFIG, show_marquee: false, show_tagline: false, show_quote: false });
    renderHome();
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    expect(document.querySelector('.home-ticker')).toBeNull();
    expect(document.querySelector('.home-mast__quote')).toBeNull();
    expect(document.querySelector('.home-mast__tagline')).toBeNull();
  });

  test('只關掉跑馬燈，標語與引言不受影響', async () => {
    mockFetchOk([], { ...MASTHEAD_CONFIG, show_marquee: false });
    renderHome();
    await waitFor(() => expect(document.querySelector('.home-mast__quote')).not.toBeNull());
    expect(document.querySelector('.home-ticker')).toBeNull();
    expect(document.querySelector('.home-mast__tagline')).not.toBeNull();
  });

  test('設定端點失敗：用預設設定（沒有跑馬燈、標語、引言），首頁其餘照常', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/homepage-config/')) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [announcementItem] }) });
    }));
    renderHome();
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    expect(screen.getByText('原語')).toBeInTheDocument();
    expect(document.querySelector('.home-ticker')).toBeNull();
    expect(document.querySelector('.home-mast__quote')).toBeNull();
  });

  test('後端漏帶新欄位（舊版後端）時退回預設，不會出錯', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG });
    renderHome();
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    expect(document.querySelector('.home-ticker')).toBeNull();
  });
});

describe('首頁 · 宣傳影片（S6-2，讀後台公開設定）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const PROMO = {
    id: 3, title: '認識原語', description: '三分鐘看懂平台。', transcript: '逐字稿內容',
    video_url: '/media/homepage/video/a.mp4', cover_url: '/media/homepage/cover/a.webp',
    caption_url: null, duration_seconds: 412, available: true,
  };

  test('沒有啟用中的影片（null）、載入前、設定失敗：整區不輸出', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, promo_video: null });
    renderHome();
    expect(document.querySelector('.home-promo')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    expect(document.querySelector('.home-promo')).toBeNull();
  });

  test('有啟用中的影片：輸出宣傳區，在報頭之後、主視覺之前，並顯示標題與說明', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, promo_video: PROMO });
    renderHome();
    expect(await screen.findByRole('region', { name: '宣傳影片' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '認識原語' })).toBeInTheDocument();
    const order = [...document.querySelector('.homepage').children].map((el) => el.className);
    expect(order[0]).toContain('home-mast');
    expect(order[1]).toContain('home-first');
    expect(document.querySelector('.home-first > .home-promo')).not.toBeNull();
    expect(order[2]).toContain('home-hero');
  });

  test('影片缺檔（available 為 false）：仍輸出，顯示無法播放與逐字稿', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, promo_video: { ...PROMO, available: false, video_url: null } });
    renderHome();
    expect(await screen.findByText('影片目前無法播放。')).toBeInTheDocument();
    expect(screen.getByText('逐字稿內容')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });
});

describe('首頁 · 第一屏（S6-4：影片、活動消息、族語認證公告並排）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const PROMO = {
    id: 3, title: '認識原語', description: '', transcript: '',
    video_url: '/media/homepage/video/a.mp4', cover_url: '/media/homepage/cover/a.webp',
    caption_url: null, duration_seconds: 412, available: true,
  };
  const cols = () => document.querySelector('.home-first')?.style.getPropertyValue('--home-first-cols');

  test('三塊都有：影片、消息、公告在同一層，欄寬比 5:4:3，都在主視覺之前', async () => {
    mockFetchOk([activityAnnouncementItem, examAnnouncementItem], { ...DEFAULT_CONFIG, promo_video: PROMO });
    renderHome();
    await screen.findByTestId('news-mock');
    const first = document.querySelector('.home-first');
    expect(cols()).toBe('minmax(0, 5fr) minmax(0, 4fr) minmax(0, 3fr)');
    expect(first.querySelector('.home-promo')).not.toBeNull();
    expect(first.querySelector('[data-testid="news-mock"]')).not.toBeNull();
    expect(first.querySelector('[data-testid="calendar-mock"]')).not.toBeNull();
    const hero = document.querySelector('.home-hero');
    expect(first.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('沒有影片：消息與公告重新分配欄寬，不留空欄', async () => {
    mockFetchOk([], DEFAULT_CONFIG);
    renderHome();
    await screen.findByTestId('news-mock');
    expect(cols()).toBe('minmax(0, 4fr) minmax(0, 3fr)');
  });

  test('只開消息（公告關閉、沒有影片）：單欄', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, show_calendar_section: false });
    renderHome();
    await screen.findByTestId('news-mock');
    expect(cols()).toBe('minmax(0, 4fr)');
  });

  test('影片、消息、公告全部沒有：不輸出第一屏這一層', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, show_news_section: false, show_calendar_section: false });
    renderHome();
    await screen.findByTestId('functionbtn-mock');
    expect(document.querySelector('.home-first')).toBeNull();
  });

  test('消息載入失敗：第一屏只顯示那一欄的錯誤說明，公告與影片不受影響', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/homepage-config/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ...DEFAULT_CONFIG, promo_video: PROMO }) });
      }
      return Promise.resolve({ ok: false, status: 500 });
    }));
    renderHome();
    expect(await screen.findByText('目前無法載入最新消息，請稍後再試。')).toBeInTheDocument();
    expect(document.querySelector('.home-first > .home-first__error')).not.toBeNull();
    expect(screen.getByTestId('calendar-mock')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.home-first > .home-promo')).not.toBeNull());
  });

  test('考試期程提醒（DateReminder）移到第一屏之外，跟公告共用同一個後台開關', async () => {
    mockFetchOk([], DEFAULT_CONFIG);
    renderHome();
    await screen.findByTestId('news-mock');
    expect(document.querySelector('.home-first [data-testid="datereminder-mock"]')).toBeNull();
    expect(document.querySelector('.home-reminder [data-testid="datereminder-mock"]')).not.toBeNull();
  });

  test('show_calendar_section=false：公告與提醒一起不輸出', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, show_calendar_section: false });
    renderHome();
    await screen.findByTestId('news-mock');
    expect(screen.queryByTestId('datereminder-mock')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calendar-mock')).not.toBeInTheDocument();
  });
});
