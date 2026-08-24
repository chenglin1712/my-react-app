import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import NoteCard from './NoteCard';

/** 回歸測試：整張卡片原本是不可鍵盤操作的 <div onClick>；改成 <article> +
 * 一顆「開啟詳情」button + 一顆獨立的讚 button 之後，兩顆 button 是平行關係
 * （不是巢狀），點讚不該連帶觸發開啟詳情。 */

const NOTE = {
  id: 'note-1', username: '某人', likes: 3, likedBy: [],
  preview: '<p>內容</p>', pages: [{ title: '我的筆記標題', content: '<p>內容</p>' }], createdAt: null,
};

function renderCard(overrides = {}) {
  const props = {
    note: NOTE, isMyTab: false, isMine: false, iLike: false,
    onOpen: vi.fn(), onToggleLike: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<NoteCard {...props} />) };
}

describe('NoteCard', () => {
  test('點卡片本體會呼叫 onOpen', async () => {
    const user = userEvent.setup();
    const { props } = renderCard();

    await user.click(screen.getByText('我的筆記標題'));
    expect(props.onOpen).toHaveBeenCalledWith(NOTE);
  });

  test('點讚按鈕只會呼叫 onToggleLike，不會連帶觸發 onOpen（兩顆 button 是平行關係，不是巢狀）', async () => {
    const user = userEvent.setup();
    const { props } = renderCard();

    await user.click(screen.getByRole('button', { name: '按讚' }));
    expect(props.onToggleLike).toHaveBeenCalled();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  test('開啟詳情的按鈕可以用鍵盤 focus 到', () => {
    renderCard();
    const openButton = screen.getByText('我的筆記標題').closest('button');
    openButton.focus();
    expect(openButton).toHaveFocus();
  });

  test('沒有 pages 時標題退回預設文字，不會丟例外', () => {
    renderCard({ note: { ...NOTE, pages: [] } });
    expect(screen.getByText('標題')).toBeInTheDocument();
  });
});
