import { describe, test, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WordDetailSheet from './WordDetailSheet';

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});

const detail = {
  keyName: 'k1',
  word: '上面',
  result: { name: 'babaw', frequency: 3, audioItems: [{ fileId: 'f1' }], explanationItems: [{ chineseExplanation: '上面', partOfSpeech: '名詞' }] },
};

const base = { onClose: vi.fn(), isMobile: false, isFavorited: false, toggleFavorite: vi.fn(), playAudio: vi.fn(), playSentence: vi.fn(), hasSentenceAudio: true, failedAudio: new Set() };

describe('WordDetailSheet', () => {
  test('沒有 detail 時不顯示任何內容', () => {
    render(<WordDetailSheet {...base} detail={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('有 detail 時是 dialog，標題是詞、副標是詞義，內容含詞性', () => {
    render(<WordDetailSheet {...base} detail={detail} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('babaw');
    expect(screen.getByText('上面', { selector: '.word-sheet-gloss' })).toBeInTheDocument();
    expect(screen.getByText('名詞')).toBeInTheDocument();
  });

  test('手機從底部、桌面從右側', () => {
    const { rerender } = render(<WordDetailSheet {...base} detail={detail} isMobile={false} />);
    expect(screen.getByRole('dialog')).toHaveClass('word-sheet--end');
    rerender(<WordDetailSheet {...base} detail={detail} isMobile />);
    expect(screen.getByRole('dialog')).toHaveClass('word-sheet--bottom');
  });

  test('按 Esc 關閉', () => {
    const onClose = vi.fn();
    render(<WordDetailSheet {...base} detail={detail} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(onClose).toHaveBeenCalled();
  });

  test('關閉鈕呼叫 onClose；收藏鈕帶 aria-pressed 並以詞名呼叫 toggleFavorite；播放鈕播第一個音檔', () => {
    const onClose = vi.fn();
    const toggleFavorite = vi.fn();
    const playAudio = vi.fn();
    render(<WordDetailSheet {...base} detail={detail} onClose={onClose} toggleFavorite={toggleFavorite} playAudio={playAudio} isFavorited />);
    fireEvent.click(screen.getByRole('button', { name: '關閉詳情' }));
    expect(onClose).toHaveBeenCalled();
    const fav = screen.getByRole('button', { name: '取消收藏' });
    expect(fav).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(fav);
    expect(toggleFavorite).toHaveBeenCalledWith('babaw');
    fireEvent.click(screen.getByRole('button', { name: '播放「babaw」的發音' }));
    expect(playAudio).toHaveBeenCalledWith('f1');
  });
});
