import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLayout from './AdminLayout';

let mockRole = 'owner';
let mockName;
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole, firestoreData: mockName ? { name: mockName } : null }, loading: false }),
}));
const mockSignOut = vi.fn();
vi.mock('../../userServives/userServive', () => ({ signOut: (...args) => mockSignOut(...args) }));

function renderLayout({ initialEntries = ['/admin'], pendingCounts } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/admin" element={<AdminLayout pendingCounts={pendingCounts} />}>
          <Route index element={<div>DASHBOARD_CONTENT</div>} />
          <Route path="content/announcements" element={<div>ANNOUNCEMENTS_CONTENT</div>} />
          <Route path="analytics/search" element={<div>SEARCH_ANALYTICS_CONTENT</div>} />
          <Route path="analytics/quiz-quality" element={<div>QUIZ_QUALITY_CONTENT</div>} />
          <Route path="analytics/retention" element={<div>RETENTION_CONTENT</div>} />
          <Route path="dictionary/words" element={<div>WORDS_CONTENT</div>} />
          <Route path="dictionary/words/new" element={<div>WORD_NEW_CONTENT</div>} />
          <Route path="dictionary/grammar" element={<div>GRAMMAR_CONTENT</div>} />
          <Route path="dictionary/taxonomies" element={<div>TAXONOMIES_CONTENT</div>} />
          <Route path="dictionary/import" element={<div>IMPORT_CONTENT</div>} />
          <Route path="users/new" element={<div>USER_NEW_CONTENT</div>} />
          <Route path="users/:uid" element={<div>USER_DETAIL_CONTENT</div>} />
        </Route>
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout', () => {
  beforeEach(() => { mockRole = 'owner'; mockName = undefined; mockSignOut.mockReset(); });

  test('渲染品牌名稱與 Outlet 帶入的頁面內容', () => {
    renderLayout();
    expect(screen.getByText('源·語')).toBeInTheDocument();
    expect(screen.getByText('ADMIN CONSOLE')).toBeInTheDocument();
    expect(screen.getByText('DASHBOARD_CONTENT')).toBeInTheDocument();
  });

  test('公告管理／考試時程／首頁版位／詞條／主檔／語法／批次匯入是真的連結，其餘未上線模組顯示「規劃中」且不是可點的連結', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: /公告管理/ })).toHaveAttribute('href', '/admin/content/announcements');
    expect(screen.getByRole('link', { name: /考試時程/ })).toHaveAttribute('href', '/admin/content/exam-schedule');
    expect(screen.getByRole('link', { name: /首頁版位/ })).toHaveAttribute('href', '/admin/content/homepage');
    // P4.1 詞條 CRUD 上線後，「詞條」已經是真的連結——不再是規劃中佔位項目。
    expect(screen.getByRole('link', { name: /詞條/ })).toHaveAttribute('href', '/admin/dictionary/words');
    // P4.2 主檔管理上線後，「主檔」也是真的連結。
    expect(screen.getByRole('link', { name: /主檔/ })).toHaveAttribute('href', '/admin/dictionary/taxonomies');
    // P4.3 語法管理上線後，「語法」也是真的連結。
    expect(screen.getByRole('link', { name: /語法/ })).toHaveAttribute('href', '/admin/dictionary/grammar');
    // P4.4 批次匯入／匯出精靈上線後，這一項也是真的連結。
    expect(screen.getByRole('link', { name: /批次匯入／匯出/ })).toHaveAttribute('href', '/admin/dictionary/import');
    // P5.2 搜尋分析上線後，「分析」群組裡這一項也是真的連結。
    expect(screen.getByRole('link', { name: /搜尋分析/ })).toHaveAttribute('href', '/admin/analytics/search');
    // P5.3 題目品質分析上線後，「分析」群組原本規劃中的「學習數據」佔位
    // 換成這一項真的連結。
    expect(screen.getByRole('link', { name: /題目品質分析/ })).toHaveAttribute('href', '/admin/analytics/quiz-quality');
    // P5.4 留存分析上線後，「分析」群組新增這一項真的連結（P5 數據分析
    // 到此四個子頁面全部上線）。
    expect(screen.getByRole('link', { name: /留存分析/ })).toHaveAttribute('href', '/admin/analytics/retention');
    expect(screen.queryByText('學習數據')).not.toBeInTheDocument();
  });

  test('題庫群組的四個項目（中高級／高級、外部題源、情境題、IRT 參數）都是真的連結', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: /中高級／高級/ })).toHaveAttribute('href', '/admin/quiz-bank/vocab');
    expect(screen.getByRole('link', { name: /外部題源/ })).toHaveAttribute('href', '/admin/quiz-bank/sources');
    expect(screen.getByRole('link', { name: /情境題/ })).toHaveAttribute('href', '/admin/quiz-bank/situations');
    expect(screen.getByRole('link', { name: /IRT 參數/ })).toHaveAttribute('href', '/admin/quiz-bank/irt-config');
  });

  test('並行項目上線後，「遊戲」群組與「系統」群組的項目都是真的連結，不再是規劃中佔位', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: /遊戲參數設定/ })).toHaveAttribute('href', '/admin/games/settings');
    expect(screen.getByRole('link', { name: /快取管理/ })).toHaveAttribute('href', '/admin/system/cache');
    expect(screen.getByRole('link', { name: /限流設定/ })).toHaveAttribute('href', '/admin/system/rate-limits');
    expect(screen.getByRole('link', { name: /功能開關/ })).toHaveAttribute('href', '/admin/system/feature-flags');
    expect(screen.getByRole('link', { name: /AI 用量/ })).toHaveAttribute('href', '/admin/system/ai-usage');
    expect(screen.queryByText('系統維運')).not.toBeInTheDocument();
  });

  test('待辦數量 > 0 時該佇列旁邊顯示徽章，數量是 0 或未提供時不顯示', () => {
    const { unmount } = renderLayout({ pendingCounts: { '/admin/content/announcements': 3 } });
    expect(screen.getByText('3')).toBeInTheDocument();
    unmount();

    renderLayout({ pendingCounts: { '/admin/content/announcements': 0 } });
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  test('五個審核佇列與公告都能顯示待辦徽章，徽章帶報讀文字，超過 99 顯示 99+', () => {
    renderLayout({
      pendingCounts: {
        '/admin/review': 4,
        '/admin/verification': 7,
        '/admin/moderation/notes': 2,
        '/admin/moderation/recordings': 5,
        '/admin/moderation/reports': 150,
      },
    });
    const badgeOf = (name) => within(screen.getByRole('link', { name })).getByText(/\d/);
    expect(badgeOf(/送審佇列/)).toHaveTextContent('4');
    expect(badgeOf(/待專家驗證佇列/)).toHaveTextContent('7');
    expect(badgeOf(/分享筆記/)).toHaveTextContent('2');
    expect(badgeOf(/發音錄音/)).toHaveTextContent('5');
    expect(badgeOf(/檢舉佇列/)).toHaveTextContent('99+');
    expect(screen.getByRole('link', { name: /送審佇列/ })).toHaveAccessibleName(/4\s*項待辦/);
  });

  test('顯示使用者名稱與角色中文，不顯示原始角色代碼；沒有名稱時只顯示角色', () => {
    mockRole = 'reviewer';
    mockName = '林小明';
    const { unmount } = renderLayout();
    const topbar = document.querySelector('.admin-topbar-user');
    expect(within(topbar).getByText('林小明')).toBeInTheDocument();
    expect(within(topbar).getByText('審核者')).toBeInTheDocument();
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
    unmount();

    mockName = undefined;
    renderLayout();
    expect(within(document.querySelector('.admin-topbar-user')).getByText('審核者')).toBeInTheDocument();
    expect(screen.queryByText('reviewer')).not.toBeInTheDocument();
  });

  test('窄螢幕選單：開關按鈕展開側欄、主內容 inert，Esc 關閉並把焦點還給開關', async () => {
    renderLayout();
    const toggle = screen.getByLabelText('開啟主選單');
    const shell = document.querySelector('.admin-shell');
    const main = document.querySelector('.admin-main-column');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(shell).not.toHaveClass('is-nav-open');
    expect(main).not.toHaveAttribute('inert');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(shell).toHaveClass('is-nav-open');
    expect(main).toHaveAttribute('inert');
    await waitFor(() => expect(document.querySelector('.admin-nav-close')).toHaveFocus());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(shell).not.toHaveClass('is-nav-open');
    expect(main).not.toHaveAttribute('inert');
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  test('窄螢幕選單：點背景可關閉；點選單裡的連結換頁後選單自動收起', () => {
    renderLayout();
    fireEvent.click(screen.getByLabelText('開啟主選單'));
    fireEvent.click(document.querySelector('.admin-nav-backdrop'));
    expect(document.querySelector('.admin-shell')).not.toHaveClass('is-nav-open');

    fireEvent.click(screen.getByLabelText('開啟主選單'));
    expect(document.querySelector('.admin-shell')).toHaveClass('is-nav-open');
    fireEvent.click(screen.getByRole('link', { name: /公告管理/ }));
    expect(screen.getByText('ANNOUNCEMENTS_CONTENT')).toBeInTheDocument();
    expect(document.querySelector('.admin-shell')).not.toHaveClass('is-nav-open');
    expect(document.querySelector('.admin-nav-backdrop')).toBeNull();
  });

  test('窄螢幕選單：點目前所在頁的連結（路徑沒變）也會關閉；開著時跳過連結被停用', () => {
    renderLayout({ initialEntries: ['/admin/content/announcements'] });
    fireEvent.click(screen.getByLabelText('開啟主選單'));
    expect(document.querySelector('.admin-shell')).toHaveClass('is-nav-open');
    expect(screen.getByText('跳到後台主要內容')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('link', { name: /公告管理/ }));
    expect(document.querySelector('.admin-shell')).not.toHaveClass('is-nav-open');
    expect(screen.getByText('跳到後台主要內容')).not.toHaveAttribute('inert');
  });

  test('登出成功後導回前台首頁', async () => {
    mockSignOut.mockResolvedValue();
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: '登出' }));
    expect(await screen.findByText('HOME')).toBeInTheDocument();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  test('登出失敗時留在後台並顯示提示', async () => {
    mockSignOut.mockRejectedValue(new Error('network'));
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: '登出' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('登出失敗'));
    expect(screen.getByText('DASHBOARD_CONTENT')).toBeInTheDocument();
  });

  test('側邊欄與頂欄都顯示目前角色的中文標籤', () => {
    mockRole = 'editor';
    renderLayout();
    expect(screen.getAllByText('內容編輯').length).toBeGreaterThan(0);
  });

  test('切換到公告管理路由時，該項目在導覽列標記為 active', () => {
    renderLayout({ initialEntries: ['/admin/content/announcements'] });
    expect(screen.getByText('ANNOUNCEMENTS_CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /公告管理/ })).toHaveClass('active');
  });

  test('搜尋分析路由顯示對應內容、導覽列標記 active，且麵包屑正確', () => {
    renderLayout({ initialEntries: ['/admin/analytics/search'] });
    expect(screen.getByText('SEARCH_ANALYTICS_CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /搜尋分析/ })).toHaveClass('active');
    const breadcrumb = screen.getByLabelText('麵包屑');
    expect(within(breadcrumb).getByText('分析')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('搜尋分析')).toBeInTheDocument();
  });

  test('題目品質分析路由顯示內容、導覽列標記 active，且麵包屑正確', () => {
    renderLayout({ initialEntries: ['/admin/analytics/quiz-quality'] });
    expect(screen.getByText('QUIZ_QUALITY_CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /題目品質分析/ })).toHaveClass('active');
    const breadcrumb = screen.getByLabelText('麵包屑');
    expect(within(breadcrumb).getByText('分析')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('題目品質分析')).toBeInTheDocument();
  });

  test('留存分析路由顯示內容、導覽列標記 active，且麵包屑正確', () => {
    renderLayout({ initialEntries: ['/admin/analytics/retention'] });
    expect(screen.getByText('RETENTION_CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /留存分析/ })).toHaveClass('active');
    const breadcrumb = screen.getByLabelText('麵包屑');
    expect(within(breadcrumb).getByText('分析')).toBeInTheDocument();
    expect(within(breadcrumb).getByText('留存分析')).toBeInTheDocument();
  });

  /** 回歸測試：辭典大類（詞條／語法／主檔／批次匯入）上線時，NAV_GROUPS
   * 有更新但 getBreadcrumb() 自己另一份手動清單沒有跟著加，這幾頁的麵包屑
   * 會直接退回顯示網址最後一段的英文（例如 words、grammar）。改成從
   * NAV_GROUPS 動態算出來之後，這幾頁不用手動加也會自動正確。 */
  describe('回歸測試：辭典大類的麵包屑（原本完全沒有對應規則）', () => {
    test('詞條列表頁的麵包屑正確，不會退回顯示網址片段', () => {
      renderLayout({ initialEntries: ['/admin/dictionary/words'] });
      const breadcrumb = screen.getByLabelText('麵包屑');
      expect(within(breadcrumb).getByText('辭典')).toBeInTheDocument();
      expect(within(breadcrumb).getByText('詞條')).toBeInTheDocument();
      expect(within(breadcrumb).queryByText('words')).not.toBeInTheDocument();
    });

    test('語法／主檔／批次匯入頁的麵包屑也都正確', () => {
      const grammar = renderLayout({ initialEntries: ['/admin/dictionary/grammar'] });
      expect(within(screen.getByLabelText('麵包屑')).getByText('語法')).toBeInTheDocument();
      grammar.unmount();

      const taxonomies = renderLayout({ initialEntries: ['/admin/dictionary/taxonomies'] });
      expect(within(screen.getByLabelText('麵包屑')).getByText('主檔')).toBeInTheDocument();
      taxonomies.unmount();

      renderLayout({ initialEntries: ['/admin/dictionary/import'] });
      expect(within(screen.getByLabelText('麵包屑')).getByText('批次匯入／匯出')).toBeInTheDocument();
    });
  });

  /** 回歸測試：/admin/users/new 原本被 startsWith('/admin/users/') 誤判成
   * 「詳情」，其實是新增使用者，跟 /admin/users/{uid} 應該顯示不同的麵包屑。 */
  test('回歸測試：新增使用者頁的麵包屑顯示「新增」，不是「詳情」', () => {
    renderLayout({ initialEntries: ['/admin/users/new'] });
    const breadcrumb = screen.getByLabelText('麵包屑');
    expect(within(breadcrumb).getByText('新增')).toBeInTheDocument();
    expect(within(breadcrumb).queryByText('詳情')).not.toBeInTheDocument();
  });

  test('使用者詳情頁（真的 uid）的麵包屑仍然顯示「詳情」', () => {
    renderLayout({ initialEntries: ['/admin/users/abc123'] });
    const breadcrumb = screen.getByLabelText('麵包屑');
    expect(within(breadcrumb).getByText('詳情')).toBeInTheDocument();
  });
});
