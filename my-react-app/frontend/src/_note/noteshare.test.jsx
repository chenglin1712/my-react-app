import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import NoteShare from './noteshare';
import {
  fetchSharedNotesPage, fetchSharedNotesCount, fetchSharedNoteById,
  deleteSharedNote, toggleNoteLike,
} from '../userServives/noteService';
import { submitReport } from '../userServives/reportService';

// 站內確認視窗（原本是瀏覽器原生 window.confirm）：測試直接替換成可控制回傳值的 mock
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

vi.mock('../userServives/noteService', () => ({
  fetchSharedNotesPage: vi.fn(),
  fetchSharedNotesCount: vi.fn(),
  fetchSharedNoteById: vi.fn(),
  deleteSharedNote: vi.fn(),
  toggleNoteLike: vi.fn(),
}));
vi.mock('../userServives/reportService', () => ({
  submitReport: vi.fn(),
  REPORT_ALREADY_OR_DENIED: 'report/already-or-denied',
}));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: { uid: 'user-1', firestoreData: {} } }),
}));

const NOTE_A = {
  id: 'note-a', uid: 'other-user', username: '某人', likes: 2, likedBy: ['someone-else'],
  preview: '<p>內容A</p>', pages: [{ title: '標題A', content: '<p>內容A</p>' }], createdAt: null,
};
const NOTE_B = {
  id: 'note-b', uid: 'other-user', username: '某人', likes: 0, likedBy: [],
  preview: '<p>內容B</p>', pages: [{ title: '標題B', content: '<p>內容B</p>' }], createdAt: null,
};

function renderPage(initialPath = '/note/share') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/note/share" element={<NoteShare />} />
        <Route path="/note/share/:id" element={<NoteShare />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('NoteShare', () => {
  beforeEach(() => {
    fetchSharedNotesPage.mockReset();
    fetchSharedNotesCount.mockReset();
    fetchSharedNoteById.mockReset();
    deleteSharedNote.mockReset();
    toggleNoteLike.mockReset();
    submitReport.mockReset();
  });

  test('回歸測試：快速連點兩下讚，只會真的呼叫一次 toggleNoteLike，最終畫面用它回傳的結果', async () => {
    fetchSharedNotesPage.mockResolvedValue({ notes: [NOTE_A], hasMore: false, lastDoc: null });
    fetchSharedNotesCount.mockResolvedValue(1);
    let resolveToggle;
    toggleNoteLike.mockReturnValue(new Promise((resolve) => { resolveToggle = resolve; }));

    renderPage();
    await screen.findByText('標題A');

    const likeButton = screen.getByRole('button', { name: '按讚' });
    fireEvent.click(likeButton);
    fireEvent.click(likeButton);

    expect(toggleNoteLike).toHaveBeenCalledTimes(1);

    resolveToggle({ likes: 5, likedBy: ['someone-else', 'user-1'] });
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
  });

  test('回歸測試：檢舉失敗時檢舉表單維持開啟，不會被誤判成功而關閉/清空', async () => {
    fetchSharedNotesPage.mockResolvedValue({ notes: [NOTE_A], hasMore: false, lastDoc: null });
    fetchSharedNotesCount.mockResolvedValue(1);
    fetchSharedNoteById.mockResolvedValue(NOTE_A);
    submitReport.mockRejectedValue(new Error('network fail'));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('標題A');

    await user.click(screen.getByText('標題A'));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: '檢舉' }));
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));

    await waitFor(() => expect(submitReport).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '送出檢舉' })).toBeInTheDocument();
  });

  test('回歸測試：刪除某一頁唯一一筆筆記、且不是第一頁時，會自動退回上一頁', async () => {
    fetchSharedNotesPage.mockImplementation(({ filter, afterDoc }) => {
      if (filter !== 'my') return Promise.resolve({ notes: [], hasMore: false, lastDoc: null });
      if (!afterDoc) {
        return Promise.resolve({
          notes: [{ ...NOTE_A, id: 'mine-1', uid: 'user-1', pages: [{ title: '筆記1', content: '<p>A</p>' }] }],
          hasMore: true, lastDoc: 'cursor-1',
        });
      }
      return Promise.resolve({
        notes: [{ ...NOTE_A, id: 'mine-2', uid: 'user-1', pages: [{ title: '筆記2', content: '<p>B</p>' }] }],
        hasMore: false, lastDoc: 'cursor-2',
      });
    });
    fetchSharedNotesCount.mockResolvedValue(2);
    fetchSharedNoteById.mockImplementation((id) => Promise.resolve({
      id, uid: 'user-1', pages: [{ title: id === 'mine-1' ? '筆記1' : '筆記2', content: '<p></p>' }],
    }));
    deleteSharedNote.mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('radio', { name: '我的' }));
    await screen.findByText('筆記1');

    await user.click(screen.getByRole('button', { name: '下一頁' }));
    await screen.findByText('筆記2');

    await user.click(screen.getByText('筆記2'));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: '刪除筆記' }));

    await waitFor(() => expect(deleteSharedNote).toHaveBeenCalledWith('mine-2'));
    await screen.findByText('筆記1');
  });

  test('回歸測試：快速點開兩張不同卡片時，畫面顯示比較晚點的那張，不會被比較慢回來的舊請求蓋掉', async () => {
    fetchSharedNotesPage.mockResolvedValue({ notes: [NOTE_A, NOTE_B], hasMore: false, lastDoc: null });
    fetchSharedNotesCount.mockResolvedValue(2);

    let resolveA;
    fetchSharedNoteById.mockImplementation((id) => {
      if (id === NOTE_A.id) return new Promise((resolve) => { resolveA = resolve; });
      return Promise.resolve(NOTE_B);
    });

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('標題A');

    await user.click(screen.getByText('標題A'));
    await user.click(screen.getByText('標題B'));

    await screen.findByRole('dialog');
    expect(screen.getByText('標題B', { selector: '.ns-modal-title' })).toBeInTheDocument();

    resolveA(NOTE_A);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByText('標題B', { selector: '.ns-modal-title' })).toBeInTheDocument();
  });

  describe('從分享連結開啟：連結失效時要告訴使用者（F2）', () => {
    const GONE = '這則筆記已不存在或已被下架';
    const TEMP = '暫時無法開啟這則筆記';

    beforeEach(() => {
      fetchSharedNotesPage.mockResolvedValue({ notes: [NOTE_B], hasMore: false, lastDoc: null });
      fetchSharedNotesCount.mockResolvedValue(1);
    });

    test('筆記不存在（回傳 null）：顯示「已不存在或已被下架」，不開視窗，列表照常可用', async () => {
      fetchSharedNoteById.mockResolvedValue(null);
      renderPage('/note/share/no-such-note');

      expect(await screen.findByText(GONE)).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(await screen.findByText('標題B')).toBeInTheDocument();   // 其他人分享的筆記還看得到
    });

    test('筆記已下架（Firestore 規則回 permission-denied）：跟不存在一樣顯示失效，不當成網路問題', async () => {
      fetchSharedNoteById.mockRejectedValue(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
      renderPage('/note/share/taken-down');

      expect(await screen.findByText(GONE)).toBeInTheDocument();
      expect(screen.queryByText(TEMP)).not.toBeInTheDocument();
      expect(screen.queryByText(/Missing or insufficient/)).not.toBeInTheDocument();   // 英文錯誤字串不給使用者看
    });

    test('「看看其他筆記」把提示關掉，焦點移到頁面標題（原本按著的按鈕已經不存在）', async () => {
      fetchSharedNoteById.mockResolvedValue(null);
      const user = userEvent.setup();
      renderPage('/note/share/no-such-note');

      await user.click(await screen.findByRole('button', { name: '看看其他筆記' }));
      expect(screen.queryByText(GONE)).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: '筆記分享區' })).toHaveFocus();
    });

    test('重試期間按鈕維持在原地顯示「重試中…」並忽略再次點擊；失敗後回到可再試的狀態', async () => {
      let rejectRetry;
      fetchSharedNoteById.mockRejectedValueOnce(new Error('offline'));
      fetchSharedNoteById.mockReturnValueOnce(new Promise((_, reject) => { rejectRetry = reject; }));
      const user = userEvent.setup();
      renderPage('/note/share/note-a');

      const retry = await screen.findByRole('button', { name: '再試一次' });
      await user.click(retry);

      const pending = await screen.findByRole('button', { name: '重試中…' });
      expect(pending).toHaveAttribute('aria-disabled', 'true');
      expect(pending).not.toBeDisabled();           // 沒有真的 disabled：焦點才不會消失
      await user.click(pending);
      expect(fetchSharedNoteById).toHaveBeenCalledTimes(2);   // 重試中再點不會多送一次

      rejectRetry(new Error('offline again'));
      const again = await screen.findByRole('button', { name: '再試一次' });
      expect(again).not.toHaveAttribute('aria-disabled');
    });

    test('暫時讀不到（斷線）：顯示可重試的提示；再試一次成功就打開筆記、提示消失', async () => {
      fetchSharedNoteById.mockRejectedValueOnce(new Error('Failed to get document because the client is offline.'));
      fetchSharedNoteById.mockResolvedValueOnce(NOTE_A);
      const user = userEvent.setup();
      renderPage('/note/share/note-a');

      expect(await screen.findByText(TEMP)).toBeInTheDocument();
      expect(screen.queryByText(GONE)).not.toBeInTheDocument();
      expect(screen.queryByText(/client is offline/)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '再試一次' }));

      await screen.findByRole('dialog');
      expect(fetchSharedNoteById).toHaveBeenCalledTimes(2);
      expect(screen.queryByText(TEMP)).not.toBeInTheDocument();
    });

    test('重試進行中點開別張卡片：重試的結果被取代之後，「重試中」也要清掉，不能卡住', async () => {
      let rejectRetry;
      fetchSharedNoteById.mockImplementation((noteId) => {
        if (noteId === 'note-b') return Promise.resolve(NOTE_B);
        const call = fetchSharedNoteById.mock.calls.filter(([id]) => id === 'note-a').length;
        if (call === 1) return Promise.reject(new Error('offline'));
        return new Promise((_, reject) => { rejectRetry = reject; });
      });
      const user = userEvent.setup();
      renderPage('/note/share/note-a');

      await user.click(await screen.findByRole('button', { name: '再試一次' }));
      await screen.findByRole('button', { name: '重試中…' });

      await user.click(await screen.findByText('標題B'));          // 重試還沒回來，先點開別張卡片
      await screen.findByRole('dialog');

      await act(async () => { rejectRetry(new Error('offline again')); });

      const retry = await screen.findByRole('button', { name: '再試一次', hidden: true });
      expect(retry).not.toHaveAttribute('aria-disabled');         // 沒有卡在「重試中…」
    });

    test('連結正常時不出現任何失效提示', async () => {
      fetchSharedNoteById.mockResolvedValue(NOTE_A);
      renderPage('/note/share/note-a');

      await screen.findByRole('dialog');
      expect(screen.queryByText(GONE)).not.toBeInTheDocument();
      expect(screen.queryByText(TEMP)).not.toBeInTheDocument();
    });

    test('沒有帶 id 的一般列表頁不會出現提示，也不會去讀單筆筆記', async () => {
      renderPage('/note/share');

      expect(await screen.findByText('標題B')).toBeInTheDocument();
      expect(fetchSharedNoteById).not.toHaveBeenCalled();
      expect(screen.queryByText(GONE)).not.toBeInTheDocument();
    });

    test('離開頁面之後才回來的舊請求，不會再公告或設定狀態', async () => {
      const heard = [];
      const onAnnounce = (e) => heard.push(e.detail.message);
      window.addEventListener('yy:announce', onAnnounce);
      try {
        let resolveLate;
        fetchSharedNoteById.mockReturnValue(new Promise((resolve) => { resolveLate = resolve; }));
        const { unmount } = renderPage('/note/share/slow-note');
        await waitFor(() => expect(fetchSharedNoteById).toHaveBeenCalledTimes(1));

        unmount();
        resolveLate(null);                       // 離開之後才回來：結果是「不存在」
        await act(async () => { await Promise.resolve(); });

        expect(heard).not.toContain(GONE);
      } finally {
        window.removeEventListener('yy:announce', onAnnounce);
      }
    });

    test('失效時用 announce 通知螢幕報讀器', async () => {
      const heard = [];
      const onAnnounce = (e) => heard.push(e.detail.message);
      window.addEventListener('yy:announce', onAnnounce);
      try {
        fetchSharedNoteById.mockResolvedValue(null);
        renderPage('/note/share/no-such-note');
        await screen.findByText(GONE);
        expect(heard).toContain(GONE);
      } finally {
        window.removeEventListener('yy:announce', onAnnounce);
      }
    });
  });
});
