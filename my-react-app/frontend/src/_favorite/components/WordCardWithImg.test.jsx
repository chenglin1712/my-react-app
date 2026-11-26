import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WordCardWithImg from './WordCardWithImg';

const RESULT = { name: 'balay', explanationItems: [{ chineseExplanation: '真的', sentenceItems: [] }], audioItems: [] };

function renderCard(isExpanded, { isFavorited = false, toggleExpand = vi.fn(), toggleFavorite = vi.fn(), result = RESULT } = {}) {
  return render(
    <WordCardWithImg
      keyName="k"
      word="真的"
      result={result}
      isExpanded={isExpanded}
      toggleExpand={toggleExpand}
      toggleFavorite={toggleFavorite}
      wordName="balay"
      categoryId={1}
      playAudio={vi.fn()}
      failedAudio={new Set()}
      isFavorited={isFavorited}
    />,
  );
}

describe('WordCardWithImg 翻牌卡（E-7，P2-67）', () => {
  test('沒翻開時只有正面可操作，背面 inert：同一張卡不會 Tab 兩次', () => {
    const { container } = renderCard(false);
    expect(container.querySelector('.word-card-front').hasAttribute('inert')).toBe(false);
    expect(container.querySelector('.word-card-back').hasAttribute('inert')).toBe(true);
  });

  test('翻開後換成背面可操作，正面 inert', () => {
    const { container } = renderCard(true);
    expect(container.querySelector('.word-card-front').hasAttribute('inert')).toBe(true);
    expect(container.querySelector('.word-card-back').hasAttribute('inert')).toBe(false);
  });

  test('P6-1：愛心用共用的收藏鈕（aria-pressed 表示狀態），顏色走 token，沒有寫死的色碼', () => {
    const { container, rerender } = renderCard(false, { isFavorited: true });
    const heart = screen.getByRole('button', { name: /^收藏「/ });
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(heart).toHaveClass('yy-fav-btn', 'favorite-btn', 'is-favorited');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    rerender(<div />);
    renderCard(false, { isFavorited: false });
    expect(screen.getByRole('button', { name: /^收藏「/ })).toHaveAttribute('aria-pressed', 'false');
  });

  test('P6-1：點愛心只切換收藏，不會順便把卡片翻面', () => {
    const toggleExpand = vi.fn();
    const toggleFavorite = vi.fn();
    renderCard(false, { toggleExpand, toggleFavorite });
    fireEvent.click(screen.getByRole('button', { name: /^收藏「/ }));
    expect(toggleFavorite).toHaveBeenCalledTimes(1);
    expect(toggleExpand).not.toHaveBeenCalled();
  });

  test('P6-1：沒有圖片時用抽象封面（純裝飾），不是外部圖床的圖；圖片載入失敗也退回抽象封面', () => {
    const { container, rerender } = renderCard(false);
    expect(container.querySelector('.word-image-placeholder')).not.toBeNull();
    expect(container.querySelector('img.word-image')).toBeNull();
    expect(container.querySelector('.word-image-placeholder').getAttribute('aria-hidden')).toBe('true');
    rerender(<div />);
    const withImg = renderCard(false, { result: { ...RESULT, word_img: 'https://res.cloudinary.com/demo/image/upload/a.png' } });
    const img = withImg.container.querySelector('img.word-image');
    expect(img).not.toBeNull();
    fireEvent.error(img);
    expect(withImg.container.querySelector('img.word-image')).toBeNull();
    expect(withImg.container.querySelector('.word-image-placeholder')).not.toBeNull();
  });

  test('P6-1：翻面後原本有焦點的那一面變 inert，焦點掉到 body 時會移到現在可操作的那一面（不退步）', () => {
    const props = { keyName: 'k', word: '真的', result: RESULT, toggleExpand: vi.fn(), toggleFavorite: vi.fn(), wordName: 'balay', categoryId: 1, playAudio: vi.fn(), failedAudio: new Set(), isFavorited: false };
    const { container, rerender } = render(<WordCardWithImg {...props} isExpanded={false} />);
    expect(document.activeElement).toBe(document.body);
    rerender(<WordCardWithImg {...props} isExpanded />);
    expect(container.querySelector('.word-card-back')).toHaveFocus();
    document.activeElement.blur();   // 模擬焦點掉回 body
    rerender(<WordCardWithImg {...props} isExpanded={false} />);
    expect(container.querySelector('.word-card-front')).toHaveFocus();
  });

  test('P6-1：焦點在愛心上按 Enter／空白，不會冒泡成「翻面」（只有卡片本身有焦點時才翻）', () => {
    const toggleExpand = vi.fn();
    const { container } = renderCard(false, { toggleExpand });
    const heart = screen.getByRole('button', { name: /^收藏「/ });
    fireEvent.keyDown(heart, { key: 'Enter' });
    fireEvent.keyDown(heart, { key: ' ' });
    expect(toggleExpand).not.toHaveBeenCalled();
    fireEvent.keyDown(container.querySelector('.word-card-front'), { key: 'Enter' });
    expect(toggleExpand).toHaveBeenCalledTimes(1);
  });
});
