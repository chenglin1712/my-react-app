import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import NoteModal from './NoteModal';

const NOTE = {
  id: 'note-1', uid: 'author-1', username: '某人', likes: 1,
  pages: [{ title: '標題', content: '<p>內容</p>' }],
};

function renderModal(overrides = {}) {
  const props = {
    note: NOTE, canLike: true, iLike: false, canDelete: false,
    onToggleLike: vi.fn(), onDelete: vi.fn(), onClose: vi.fn(), onReport: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<NoteModal {...props} />) };
}

describe('NoteModal', () => {
  test('回歸測試：note.pages 是空陣列時不會丟例外，標題退回預設文字', () => {
    renderModal({ note: { ...NOTE, pages: [] } });
    expect(screen.getByRole('heading', { name: '筆記內容' })).toBeInTheDocument();
  });

  test('D-5：沒有任何頁面時顯示「這則筆記沒有可顯示的內容」', () => {
    renderModal({ note: { ...NOTE, pages: [] } });
    expect(screen.getByText('這則筆記沒有可顯示的內容')).toBeInTheDocument();
  });

  test('D-5：某一頁內容是空白時，那一頁顯示「這一頁沒有內容」，其他頁照常顯示', () => {
    renderModal({ note: { ...NOTE, pages: [
      { title: '甲', content: '<p></p>' },
      { title: '乙', content: '<p>有內容</p>' },
    ] } });
    expect(screen.getByText('這一頁沒有內容')).toBeInTheDocument();
    expect(screen.getByText('有內容')).toBeInTheDocument();
    expect(screen.queryByText('這則筆記沒有可顯示的內容')).not.toBeInTheDocument();
  });

  test('D-5：內容被消毒濾光（例如只有 script）的那一頁，也算沒有內容', () => {
    renderModal({ note: { ...NOTE, pages: [{ title: '甲', content: '<script>alert(1)</script>' }] } });
    expect(screen.getByText('這一頁沒有內容')).toBeInTheDocument();
  });

  test('D-5：舊資料的 content 是 null 或不是字串時不會丟例外，視為沒有內容', () => {
    renderModal({ note: { ...NOTE, pages: [{ title: '甲', content: null }, { title: '乙', content: 123 }] } });
    expect(screen.getAllByText('這一頁沒有內容')).toHaveLength(2);
  });

  test('D-5：有內容的筆記不會出現空內容說明', () => {
    renderModal();
    expect(screen.queryByText(/沒有可顯示的內容|這一頁沒有內容/)).not.toBeInTheDocument();
  });

  test('note.pages 是 undefined 時也不會丟例外', () => {
    const { pages: _pages, ...noteWithoutPages } = NOTE;
    renderModal({ note: noteWithoutPages });
    expect(screen.getByRole('heading', { name: '筆記內容' })).toBeInTheDocument();
  });

  test('按 Escape 會關閉 Modal', () => {
    const { props } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  test('回歸測試：檢舉失敗（onReport 丟例外）時，表單維持開啟，不會被清空關閉', async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ onReport: vi.fn().mockRejectedValue(new Error('fail')) });

    await user.click(screen.getByRole('button', { name: '檢舉' }));
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));

    expect(props.onReport).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: '送出檢舉' })).toBeInTheDocument();
  });

  test('檢舉成功時會關閉檢舉表單', async () => {
    const user = userEvent.setup();
    renderModal({ onReport: vi.fn().mockResolvedValue(undefined) });

    await user.click(screen.getByRole('button', { name: '檢舉' }));
    await user.click(screen.getByRole('button', { name: '送出檢舉' }));

    expect(screen.queryByRole('button', { name: '送出檢舉' })).not.toBeInTheDocument();
  });
});
