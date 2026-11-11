import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import NoteModal from './NoteModal';
import NoteCard from './NoteCard';

// O24：消毒（DOMPurify）的成本跟內容大小成正比，不能每次 render 都重做。
const { sanitizeSpy } = vi.hoisted(() => ({ sanitizeSpy: vi.fn() }));
vi.mock('@utils/sanitizeNoteHtml', async () => {
  const actual = await vi.importActual('@utils/sanitizeNoteHtml');
  return { ...actual, sanitizeNoteHtml: (...args) => { sanitizeSpy(...args); return actual.sanitizeNoteHtml(...args); } };
});

const NOTE = {
  id: 'note-1', uid: 'a', username: '某人', likes: 1,
  pages: [
    { title: '甲', content: '<p>第一頁</p>' },
    { title: '乙', content: '<p></p>' },
    { title: '丙', content: '<p>第三頁</p>' },
  ],
};
const modalProps = (note = NOTE) => ({
  note, canLike: true, iLike: false, canDelete: false,
  onToggleLike: vi.fn(), onDelete: vi.fn(), onClose: vi.fn(), onReport: vi.fn(),
});

beforeEach(() => sanitizeSpy.mockClear());

describe('NoteModal 的消毒只在內容變動時做（O24）', () => {
  test('在檢舉說明欄連續打字，不會重新消毒任何一頁', async () => {
    const user = userEvent.setup();
    render(<NoteModal {...modalProps()} />);
    expect(sanitizeSpy).toHaveBeenCalledTimes(3);          // 三頁各一次
    await user.click(screen.getByRole('button', { name: '檢舉' }));
    await user.click(screen.getByRole('radio', { name: '其他' }));
    sanitizeSpy.mockClear();
    await user.type(screen.getByRole('textbox', { name: '補充說明' }), '不實內容');
    expect(sanitizeSpy).not.toHaveBeenCalled();
  });

  test('畫面與原本相同：空白頁顯示提示、其他頁照常顯示', () => {
    render(<NoteModal {...modalProps()} />);
    expect(screen.getByText('第一頁')).toBeInTheDocument();
    expect(screen.getByText('這一頁沒有內容')).toBeInTheDocument();
    expect(screen.getByText('第三頁')).toBeInTheDocument();
  });

  test('換成另一則筆記（pages 變了）才重新消毒', () => {
    const { rerender } = render(<NoteModal {...modalProps()} />);
    sanitizeSpy.mockClear();
    rerender(<NoteModal {...modalProps({ ...NOTE, id: 'note-2', pages: [{ title: '新', content: '<p>新內容</p>' }] })} />);
    expect(sanitizeSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('新內容')).toBeInTheDocument();
  });

  test('pages 內容含不安全標籤時仍會被消毒', () => {
    render(<NoteModal {...modalProps({ ...NOTE, pages: [{ title: 'x', content: '<p>好</p><script>alert(1)</script>' }] })} />);
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('NoteCard 的預覽只在 preview 變動時重新消毒（O24）', () => {
  const card = (note, extra = {}) => (
    <NoteCard note={note} isMyTab={false} isMine={false} iLike={false} onOpen={vi.fn()} onToggleLike={vi.fn()} {...extra} />
  );
  const BASE = { id: 'n', username: 'u', likes: 0, preview: '<p>預覽</p>', pages: [{ title: 't' }], createdAt: null };

  test('按讚造成 likes／iLike 改變時，不重新消毒預覽', () => {
    const { rerender } = render(card(BASE));
    expect(sanitizeSpy).toHaveBeenCalledTimes(1);
    rerender(card({ ...BASE, likes: 1 }, { iLike: true }));
    expect(sanitizeSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('預覽')).toBeInTheDocument();
  });

  test('preview 變了才重新消毒；沒有 preview 時用預設的「內容」', () => {
    const { rerender } = render(card(BASE));
    rerender(card({ ...BASE, preview: '<p>換了</p>' }));
    expect(sanitizeSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText('換了')).toBeInTheDocument();
    rerender(card({ ...BASE, preview: '' }));
    expect(screen.getByText('內容')).toBeInTheDocument();
  });
});
