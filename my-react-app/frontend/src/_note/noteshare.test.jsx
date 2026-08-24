import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import NoteShare from './noteshare';
import {
  fetchSharedNotesPage, fetchSharedNotesCount, fetchSharedNoteById,
  softDeleteNote, toggleNoteLike,
} from '../userServives/noteService';
import { submitReport } from '../userServives/reportService';

vi.mock('../userServives/noteService', () => ({
  fetchSharedNotesPage: vi.fn(),
  fetchSharedNotesCount: vi.fn(),
  fetchSharedNoteById: vi.fn(),
  softDeleteNote: vi.fn(),
  toggleNoteLike: vi.fn(),
}));
vi.mock('../userServives/reportService', () => ({ submitReport: vi.fn() }));
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
    softDeleteNote.mockReset();
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
    softDeleteNote.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '我的' }));
    await screen.findByText('筆記1');

    await user.click(screen.getByRole('button', { name: '下一頁' }));
    await screen.findByText('筆記2');

    await user.click(screen.getByText('筆記2'));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: '刪除筆記' }));

    await waitFor(() => expect(softDeleteNote).toHaveBeenCalledWith('mine-2'));
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
});
