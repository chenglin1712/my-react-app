import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import NotePage from './index';
import { useNotesCloudSyncFlag } from './hooks/useNotesCloudSyncFlag';
import { useCloudNoteSync } from './hooks/useCloudNoteSync';
import { exportNoteAsHtml } from './sync/exportNote';

// 站內確認視窗（原本是瀏覽器原生 window.confirm）：測試直接替換成可控制回傳值的 mock
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

/** 雲端筆記同步（D-2）接進筆記頁的接線：旗標關閉時畫面和以前一樣，開啟後才出現同步狀態。 */

const fakeEditor = {
  html: '<p></p>',
  getHTML() { return fakeEditor.html; },
  commands: { setContent: vi.fn() },
  chain: () => ({ focus: () => ({}) }),
};
vi.mock('@tiptap/react', () => ({ useEditor: () => fakeEditor, EditorContent: () => null }));
vi.mock('@tiptap/starter-kit', () => ({ StarterKit: {} }));
vi.mock('@tiptap/extension-text-style', () => ({ TextStyle: {} }));
vi.mock('@tiptap/extension-color', () => ({ Color: {} }));
vi.mock('@tiptap/extension-image', () => ({ Image: { configure: () => ({}) } }));
vi.mock('./fontSizeExtension', () => ({ default: {} }));
vi.mock('../userServives/noteService', () => ({ shareNote: vi.fn() }));
vi.mock('@utils/uploadToCloudinary', () => ({ uploadToCloudinary: vi.fn() }));
vi.mock('../../../firebase', () => ({ db: { fake: true } }));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: { uid: 'user-1', firestoreData: { name: '測試使用者' } } }),
}));
vi.mock('./hooks/useNotesCloudSyncFlag', () => ({ useNotesCloudSyncFlag: vi.fn() }));
vi.mock('./hooks/useCloudNoteSync', () => ({ useCloudNoteSync: vi.fn() }));
vi.mock('./sync/exportNote', () => ({ exportNoteAsHtml: vi.fn() }));

const LOCAL_KEY = 'userNotes_user-1';
const syncStub = (overrides = {}) => ({
  status: 'off', progress: null, notices: [], failures: [],
  dismissNotice: vi.fn(), retry: vi.fn(), retryAll: vi.fn(), recordDelete: vi.fn(),
  ...overrides,
});

const renderPage = () => render(<MemoryRouter><NotePage /></MemoryRouter>);

describe('NotePage 的雲端同步接線', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LOCAL_KEY, JSON.stringify([
      { id: 'a', title: '第一篇', content: '<p>A</p>' },
      { id: 'b', title: '第二篇', content: '<p>B</p>' },
    ]));
    confirmMock.mockResolvedValue(true);
    useNotesCloudSyncFlag.mockReset();
    useCloudNoteSync.mockReset();
    exportNoteAsHtml.mockReset();
  });

  test('旗標關閉：不顯示任何同步畫面，標題欄沒有字數限制', () => {
    useNotesCloudSyncFlag.mockReturnValue(false);
    useCloudNoteSync.mockReturnValue(syncStub());
    renderPage();

    expect(screen.queryByRole('region', { name: '雲端同步' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('筆記標題')).not.toHaveAttribute('maxlength');
    expect(useCloudNoteSync).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, uid: 'user-1' }));
  });

  test('旗標開啟：顯示同步狀態，標題欄限制 100 字（跟雲端上限一致）', () => {
    useNotesCloudSyncFlag.mockReturnValue(true);
    useCloudNoteSync.mockReturnValue(syncStub({ status: 'synced' }));
    renderPage();

    expect(screen.getByRole('region', { name: '雲端同步' })).toBeInTheDocument();
    expect(screen.getByText('已同步到雲端')).toBeInTheDocument();
    expect(screen.getByLabelText('筆記標題')).toHaveAttribute('maxlength', '100');
    expect(useCloudNoteSync).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true, db: { fake: true }, notes: expect.any(Array),
    }));
  });

  test('同步失敗的頁：側欄標示「未同步」，匯出按鈕會匯出那一頁', () => {
    useNotesCloudSyncFlag.mockReturnValue(true);
    useCloudNoteSync.mockReturnValue(syncStub({
      status: 'synced',
      failures: [{ id: 'b', code: 'image_upload', message: '內含的圖片上傳失敗，請檢查網路後重試。' }],
    }));
    renderPage();

    expect(screen.getByLabelText(/第 2 頁：第二篇（未同步）/)).toBeInTheDocument();
    expect(screen.getByLabelText(/第 1 頁：第一篇/).closest('div').textContent).not.toContain('未同步');

    fireEvent.click(screen.getByRole('button', { name: '匯出此頁' }));
    expect(exportNoteAsHtml).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', title: '第二篇' }));
  });

  test('D-5：標題欄下方有存檔狀態；旗標關閉時提醒只存在這台裝置，開啟後不再提醒', () => {
    useNotesCloudSyncFlag.mockReturnValue(false);
    useCloudNoteSync.mockReturnValue(syncStub());
    const { unmount } = renderPage();
    expect(screen.getByText(/筆記只存在這台裝置的瀏覽器/)).toBeInTheDocument();
    unmount();

    useNotesCloudSyncFlag.mockReturnValue(true);
    useCloudNoteSync.mockReturnValue(syncStub({ status: 'synced' }));
    renderPage();
    expect(screen.queryByText(/筆記只存在這台裝置的瀏覽器/)).not.toBeInTheDocument();
  });

  test('D-5：按「儲存」後狀態變成「已儲存於這台裝置」並顯示時間', () => {
    useNotesCloudSyncFlag.mockReturnValue(true);
    useCloudNoteSync.mockReturnValue(syncStub({ status: 'synced' }));
    const { container } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    expect(container.querySelector('.note-save__status')).toHaveTextContent('已儲存於這台裝置 · 剛剛');
  });

  test('刪除一頁時通知同步（帶筆記 id）', async () => {
    useNotesCloudSyncFlag.mockReturnValue(true);
    const sync = syncStub({ status: 'synced' });
    useCloudNoteSync.mockReturnValue(sync);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    await waitFor(() => expect(sync.recordDelete).toHaveBeenCalledWith('a'));
  });
});
