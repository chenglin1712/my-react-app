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
