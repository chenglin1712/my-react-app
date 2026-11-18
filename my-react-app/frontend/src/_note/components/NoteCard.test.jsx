import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    expect(screen.getByText('（未命名）')).toBeInTheDocument();
  });

  test('空標題或只有空白的標題，顯示「（未命名）」佔位，卡片高度才不會塌掉', () => {
    renderCard({ note: { ...NOTE, pages: [{ title: '   ', content: '<p>內容</p>' }] } });
    expect(screen.getByText('（未命名）')).toBeInTheDocument();
  });

  test('超長無空白標題原樣放進 DOM（斷字與兩行截斷由 CSS 負責），並用 title 屬性保留完整標題', () => {
    const long = 'https://example.com/' + 'a'.repeat(300);
    renderCard({ note: { ...NOTE, pages: [{ title: long, content: '<p>內容</p>' }] } });
    const title = screen.getByText(long);
    expect(title).toHaveClass('ns-title');
    expect(title).toHaveAttribute('title', long);
  });

  test('P5-5：有圖就用第一張圖當 16:9 封面，圖不再重複出現在預覽文字裡', () => {
    const { container } = renderCard({ note: { ...NOTE, preview: '<p>文字</p><img src="https://res.cloudinary.com/demo/image/upload/a.png">' } });
    expect(container.querySelector('.ns-cover img')).toHaveAttribute('src', 'https://res.cloudinary.com/demo/image/upload/a.png');
    expect(container.querySelector('.ns-preview img')).toBeNull();
  });

  test('P5-5：沒有圖或圖載入失敗，都改畫預設封面（封面區塊一律存在，卡片高度一致）', () => {
    const { container } = renderCard();
    expect(container.querySelector('.ns-cover')).not.toBeNull();
    expect(container.querySelector('.ns-cover img')).toBeNull();
    expect(container.querySelector('.ns-cover-fallback')).not.toBeNull();
  });

  test('P5-5：封面圖載入失敗時退回預設封面', () => {
    const { container } = renderCard({ note: { ...NOTE, preview: '<img src="https://res.cloudinary.com/demo/image/upload/a.png">' } });
    fireEvent.error(container.querySelector('.ns-cover img'));
    expect(container.querySelector('.ns-cover img')).toBeNull();
    expect(container.querySelector('.ns-cover-fallback')).not.toBeNull();
  });

  test('P5-5：同一張卡片換成另一則有效封面時，不會被先前的載入失敗卡住', () => {
    const a = { ...NOTE, preview: '<img src="https://res.cloudinary.com/demo/image/upload/a.png">' };
    const b = { ...NOTE, preview: '<img src="https://res.cloudinary.com/demo/image/upload/b.png">' };
    const { container, rerender } = renderCard({ note: a });
    fireEvent.error(container.querySelector('.ns-cover img'));
    expect(container.querySelector('.ns-cover img')).toBeNull();
    rerender(<NoteCard note={b} isMyTab={false} isMine={false} iLike={false} onOpen={vi.fn()} onToggleLike={vi.fn()} />);
    expect(container.querySelector('.ns-cover img')).toHaveAttribute('src', 'https://res.cloudinary.com/demo/image/upload/b.png');
  });
});
