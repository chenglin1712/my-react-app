import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
  default: (props) => (
    <div>
      <div data-testid="news-mock">{JSON.stringify(props)}</div>
      <button type="button" onClick={props.onRetry}>重新載入</button>
    </div>
  ),
}));
vi.mock('../../components/_home/calendar', () => ({
  default: (props) => (
    <div>
      <div data-testid="calendar-mock">{JSON.stringify(props)}</div>
      <button type="button" onClick={props.onRetry}>重新載入時程</button>
    </div>
  ),
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

const EXAM_SCHEDULE = {
  session: '115年度原住民族語言能力認證日程表',
  phases: [
    { phase: '測驗', start_date: '2026-11-08', end_date: null },
    { phase: '報名', start_date: '2026-09-01', end_date: '2026-09-15' },
  ],
};

function mockFetchOk(announcementResults, homepageConfig = DEFAULT_CONFIG, featuredTopicItems = []) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url.includes('/adminapi/public/announcements/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: announcementResults }) });
    }
    if (url.includes('/adminapi/public/homepage-config/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(homepageConfig) });
    }
    if (url.includes('/adminapi/public/featured-topics/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: featuredTopicItems }) });
    }
    if (url.includes('/crawler/exam_schedule/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(EXAM_SCHEDULE) });
    }
    return Promise.reject(new Error(`unexpected url: ${url}`));
  }));
}

describe('首頁 · 後台公告（單一來源，含爬蟲匯入內容）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('category=exam 的公告和其他公告一起進最新消息；右欄是認證時程，不是公告', async () => {
    mockFetchOk([announcementItem, examAnnouncementItem]);
    renderHome();

    await waitFor(() => {
      const newsProps = JSON.parse(screen.getByTestId('news-mock').textContent);
      const allTitles = [...newsProps.withImage, ...newsProps.withoutImage].map((item) => item.title);
      expect(allTitles).toContain('族語認證公告');
      expect(allTitles).toContain('後台公告');
    });
    await waitFor(() => {
      const calendarProps = JSON.parse(screen.getByTestId('calendar-mock').textContent);
      expect(calendarProps.loading).toBe(false);
      expect(calendarProps.error).toBe(false);
      // 依開始日排序，屆次名稱去掉結尾的「日程表」
      expect(calendarProps.schedule.session).toBe('115年度原住民族語言能力認證');
      expect(calendarProps.schedule.phases.map((p) => p.phase)).toEqual(['報名', '測驗']);
    });
  });

  test('時程端點失敗：只有認證時程那一欄顯示錯誤，按重新載入會重打並恢復', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/crawler/exam_schedule/')) {
        return fail ? Promise.resolve({ ok: false, status: 500 }) : Promise.resolve({ ok: true, json: () => Promise.resolve(EXAM_SCHEDULE) });
      }
      if (url.includes('/adminapi/public/announcements/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
      if (url.includes('/adminapi/public/featured-topics/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_CONFIG) });
    }));
    renderHome();
    await waitFor(() => expect(JSON.parse(screen.getByTestId('calendar-mock').textContent).error).toBe(true));
    expect(JSON.parse(screen.getByTestId('news-mock').textContent).error).toBe(false);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新載入時程' }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('calendar-mock').textContent).error).toBe(false));
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
    await waitFor(() => expect(JSON.parse(screen.getByTestId('news-mock').textContent).error).toBe(true));
    expect(screen.getByTestId('calendar-mock')).toBeInTheDocument();
  });

  test('按「重新載入」會重打公告端點，成功後錯誤狀態消失', async () => {
    let fail = true;
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/announcements/')) {
        return fail
          ? Promise.resolve({ ok: false, status: 500 })
          : Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [announcementItem] }) });
      }
      if (url.includes('/adminapi/public/homepage-config/')) return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_CONFIG) });
      if (url.includes('/adminapi/public/featured-topics/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHome();
    await waitFor(() => expect(JSON.parse(screen.getByTestId('news-mock').textContent).error).toBe(true));
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(JSON.parse(screen.getByTestId('news-mock').textContent).error).toBe(false));
    expect(globalThis.fetch.mock.calls.filter(([u]) => u.includes('/announcements/'))).toHaveLength(2);
  });
});

describe('首頁 · 版位設定（HomepageConfig）套用', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  test('版位設定端點失敗時維持預設值，不影響其餘畫面渲染', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/homepage-config/')) return Promise.reject(new Error('設定端點掛了'));
      if (url.includes('/adminapi/public/announcements/')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }));
    renderHome();
    expect(await screen.findByTestId('calendar-mock')).toBeInTheDocument();
    expect(screen.getByTestId('news-mock')).toBeInTheDocument();
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

describe('首頁 · 最新消息只放最新四則', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const makeItems = (n) => Array.from({ length: n }, (_, i) => ({
    ...announcementItem, id: 100 + i, title: `公告${i + 1}`,
  }));
  const shown = () => {
    const props = JSON.parse(screen.getByTestId('news-mock').textContent);
    return [...props.withImage, ...props.withoutImage].map((item) => item.title);
  };

  test('後台有很多則：首頁只取最前面的四則，順序不變', async () => {
    mockFetchOk(makeItems(9));
    renderHome();
    await waitFor(() => expect(shown()).toEqual(['公告1', '公告2', '公告3', '公告4']));
  });

  test('後台設定的筆數比四則少：照後台設定', async () => {
    mockFetchOk(makeItems(9), { ...DEFAULT_CONFIG, news_display_count: 2 });
    renderHome();
    await waitFor(() => expect(shown()).toEqual(['公告1', '公告2']));
  });

  test('考試類公告也在最新消息裡（認證欄是時程，不是公告）', async () => {
    mockFetchOk([examAnnouncementItem]);
    renderHome();
    await waitFor(() => expect(shown()).toEqual(['族語認證公告']));
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

  test('設定載入前與後台從沒填過：顯示預設文字（跑馬燈、標語、引言），不是空白', async () => {
    mockFetchOk([]);
    renderHome();
    // 載入前（預設值）
    expect(screen.getByRole('heading', { level: 1, name: '原語' })).toBeInTheDocument();
    expect(screen.getByText('YUAN・YU', { selector: '.home-mast__en-name' })).toBeInTheDocument();
    expect(document.querySelector('.home-ticker')).not.toBeNull();
    expect(document.querySelector('.home-mast__quote')).toHaveTextContent('每一種語言，都是一座回得去的家。');
    expect(document.querySelector('.home-mast__tagline')).toHaveTextContent('讓語言回家');
    // 載入後（後端回的也是空）
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    expect(document.querySelector('.home-ticker')).not.toBeNull();
    expect(document.querySelector('.home-mast__quote')).not.toBeNull();
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
    expect(order[2]).toContain('home-nav-slot');
    expect(order[3]).toContain('home-first');
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

  test('設定端點失敗：用預設設定（預設文字的跑馬燈、標語、引言），首頁其餘照常', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/homepage-config/')) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [announcementItem] }) });
    }));
    renderHome();
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: '原語' })).toBeInTheDocument();
    expect(document.querySelector('.home-ticker')).not.toBeNull();
    expect(document.querySelector('.home-mast__quote')).not.toBeNull();
  });

  test('後端漏帶新欄位（舊版後端）時退回預設，不會出錯', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG });
    renderHome();
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    expect(document.querySelector('.home-ticker')).not.toBeNull();
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

  test('沒有啟用中的影片（null）、載入前、設定失敗：放示意卡（不是播放器，沒有可按的東西）', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, promo_video: null });
    renderHome();
    expect(document.querySelector('.home-promo--placeholder')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('news-mock')).toBeInTheDocument());
    const card = document.querySelector('.home-promo--placeholder');
    expect(card).not.toBeNull();
    expect(card.querySelector('button, a, video')).toBeNull();
    expect(card).toHaveTextContent('示意影片');
  });

  test('有啟用中的影片：輸出宣傳區，在報頭之後的第一屏左欄，並顯示標題與說明', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, promo_video: PROMO });
    renderHome();
    expect(await screen.findByRole('region', { name: '宣傳影片' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '認識原語' })).toBeInTheDocument();
    const order = [...document.querySelector('.homepage').children].map((el) => el.className);
    expect(order[1]).toContain('home-mast');
    expect(order[3]).toContain('home-first');
    expect(document.querySelector('.home-first > .home-first__lead .home-promo')).not.toBeNull();
  });

  test('影片缺檔（available 為 false）：仍輸出，顯示無法播放與逐字稿', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, promo_video: { ...PROMO, available: false, video_url: null } });
    renderHome();
    expect(await screen.findByText('影片目前無法播放。')).toBeInTheDocument();
    expect(screen.getByText('逐字稿內容')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });
});

describe('首頁 · 第一屏（S6-4：影片、活動消息、族語認證時程並排）', () => {
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
  });

  test('沒有影片：左欄放示意卡加大標題與說明，三欄 5:4:3', async () => {
    mockFetchOk([], DEFAULT_CONFIG);
    renderHome();
    await screen.findByTestId('news-mock');
    expect(cols()).toBe('minmax(0, 5fr) minmax(0, 4fr) minmax(0, 3fr)');
    expect(document.querySelector('.home-first__lead .home-intro__title')).toHaveTextContent('讓語言回家');
    expect(document.querySelector('.home-first__lead .home-intro__lede')).toHaveTextContent('用查詞、聽發音和故事，把族語帶回日常。');
  });

  test('標語關閉：左欄仍有示意卡，三欄不變', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, show_tagline: false });
    renderHome();
    await screen.findByTestId('news-mock');
    expect(cols()).toBe('minmax(0, 5fr) minmax(0, 4fr) minmax(0, 3fr)');
    expect(document.querySelector('.home-first__lead .home-intro')).toBeNull();
  });

  test('公告關閉：左欄與消息兩欄，欄寬 5:4', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, show_calendar_section: false });
    renderHome();
    await screen.findByTestId('news-mock');
    expect(cols()).toBe('minmax(0, 5fr) minmax(0, 4fr)');
  });

  test('消息與公告都關閉：只剩左欄', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, show_news_section: false, show_calendar_section: false });
    renderHome();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(4));
    expect(cols()).toBe('minmax(0, 5fr)');
    expect(document.querySelector('[data-testid="news-mock"]')).toBeNull();
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
    await waitFor(() => expect(JSON.parse(screen.getByTestId('news-mock').textContent).error).toBe(true));
    expect(screen.getByTestId('calendar-mock')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.home-first .home-promo')).not.toBeNull());
  });

  test('show_calendar_section=false：公告與提醒一起不輸出', async () => {
    mockFetchOk([], { ...DEFAULT_CONFIG, show_calendar_section: false });
    renderHome();
    await screen.findByTestId('news-mock');
    expect(screen.queryByTestId('datereminder-mock')).not.toBeInTheDocument();
    expect(screen.queryByTestId('calendar-mock')).not.toBeInTheDocument();
  });
});

describe('首頁 · 本期專題（S7-1）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const topic = (id) => ({
    id, title: `專題${id}`, summary: `摘要${id}`, image_url: '', link_url: `https://example.org/${id}`, category_label: '文化',
  });

  test('有已發布的專題：在第一屏之後輸出，依回傳順序', async () => {
    mockFetchOk([], DEFAULT_CONFIG, [topic(1), topic(2), topic(3)]);
    renderHome();
    expect(await screen.findByRole('heading', { level: 2, name: '本期專題' })).toBeInTheDocument();
    const section = document.querySelector('.topics-section');
    expect(within(section).getAllByRole('heading', { level: 3 }).map((h) => h.textContent.replace('（另開新視窗）', ''))).toEqual(['專題1', '專題2', '專題3']);
    expect(document.querySelector('.home-first').compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('0 筆：放三張示意卡（沒有連結），不是空白', async () => {
    mockFetchOk([], DEFAULT_CONFIG, []);
    renderHome();
    expect(await screen.findByRole('heading', { level: 2, name: '本期專題' })).toBeInTheDocument();
    const section = document.querySelector('.topics-section');
    expect(within(section).getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(within(section).queryByRole('link')).toBeNull();
  });

  test('專題還沒回來之前不先閃示意卡', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => (url.includes('/featured-topics/')
      ? new Promise(() => {})
      : Promise.resolve({ ok: true, json: () => Promise.resolve(url.includes('/announcements/') ? { results: [] } : DEFAULT_CONFIG) }))));
    renderHome();
    await screen.findByTestId('news-mock');
    expect(document.querySelector('.topics-section')).toBeNull();
  });

  test('專題端點失敗：退回示意卡，設定與公告照常', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/featured-topics/')) return Promise.resolve({ ok: false, status: 500 });
      if (url.includes('/adminapi/public/announcements/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_CONFIG) });
    }));
    renderHome();
    await screen.findByTestId('news-mock');
    expect(await screen.findByRole('heading', { name: '本期專題' })).toBeInTheDocument();
    expect(screen.getByTestId('calendar-mock')).toBeInTheDocument();
  });

  test('專題與設定各自獨立：設定端點失敗不影響專題', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('/adminapi/public/homepage-config/')) return Promise.resolve({ ok: false, status: 500 });
      if (url.includes('/adminapi/public/featured-topics/')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [topic(1)] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) });
    }));
    renderHome();
    expect(await screen.findByRole('heading', { level: 2, name: '本期專題' })).toBeInTheDocument();
  });
});
