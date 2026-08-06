import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminLayout from './AdminLayout';

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

function renderLayout({ initialEntries = ['/admin'], pendingAnnouncementCount } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/admin" element={<AdminLayout pendingAnnouncementCount={pendingAnnouncementCount} />}>
          <Route index element={<div>DASHBOARD_CONTENT</div>} />
          <Route path="content/announcements" element={<div>ANNOUNCEMENTS_CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminLayout', () => {
  beforeEach(() => { mockRole = 'owner'; });

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
    // 「規劃中」的項目（學習數據，P5 才會做）不應該渲染成 <a>，避免
    // 使用者點了卻導到一個根本不存在內容的頁面。
    const plannedItem = screen.getByText('學習數據').closest('li');
    expect(within(plannedItem).queryByRole('link')).not.toBeInTheDocument();
    expect(within(plannedItem).getByText('規劃中')).toBeInTheDocument();
  });

  test('題庫群組的四個項目（中高級／高級、外部題源、情境題、IRT 參數）都是真的連結', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: /中高級／高級/ })).toHaveAttribute('href', '/admin/quiz-bank/vocab');
    expect(screen.getByRole('link', { name: /外部題源/ })).toHaveAttribute('href', '/admin/quiz-bank/sources');
    expect(screen.getByRole('link', { name: /情境題/ })).toHaveAttribute('href', '/admin/quiz-bank/situations');
    expect(screen.getByRole('link', { name: /IRT 參數/ })).toHaveAttribute('href', '/admin/quiz-bank/irt-config');
  });

  test('待審數量 > 0 時公告管理旁邊顯示徽章，數量是 0 或未提供時不顯示', () => {
    const { unmount } = renderLayout({ pendingAnnouncementCount: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
    unmount();

    renderLayout({ pendingAnnouncementCount: 0 });
    expect(screen.queryByText('0')).not.toBeInTheDocument();
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
});
