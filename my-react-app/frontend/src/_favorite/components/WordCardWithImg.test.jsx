import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import WordCardWithImg from './WordCardWithImg';

const RESULT = { name: 'balay', explanationItems: [{ chineseExplanation: '真的', sentenceItems: [] }], audioItems: [] };

function renderCard(isExpanded, { isFavorited = false, toggleExpand = vi.fn(), toggleFavorite = vi.fn(), result = RESULT, extra = {} } = {}) {
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
      {...extra}
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
    expect(within(container.querySelector('.word-card-back')).getByRole('button', { name: /^返回/ })).toHaveFocus();
    document.activeElement.blur();   // 模擬焦點掉回 body
    rerender(<WordCardWithImg {...props} isExpanded={false} />);
    expect(within(container.querySelector('.word-card-front')).getByRole('button', { name: /^查看/ })).toHaveFocus();
  });

  test('FE3-09：卡片本身不是 role=button，沒有巢狀的互動元件；翻面是標題裡一顆帶 aria-expanded 的真按鈕', () => {
    const toggleExpand = vi.fn();
    const { container } = renderCard(false, { toggleExpand, result: { ...RESULT, audioItems: [{ fileId: 'f1' }] } });
    expect(container.querySelector('.word-card-front').getAttribute('role')).toBeNull();
    expect(container.querySelector('.word-card-back').getAttribute('role')).toBeNull();
    for (const btn of container.querySelectorAll('button')) {
      expect(btn.parentElement.closest('button, [role="button"]')).toBeNull();
    }
    const flip = screen.getByRole('button', { name: '查看「balay」的詳細解釋' });
    expect(flip.closest('h3')).not.toBeNull();
    expect(flip).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(flip);
    expect(toggleExpand).toHaveBeenCalledWith('k');
  });

  test('FE3-09：愛心、播放鈕是翻面按鈕之外的獨立按鈕，操作它們不會翻面', () => {
    const toggleExpand = vi.fn();
    const playAudio = vi.fn();
    const { container } = renderCard(false, { toggleExpand, result: { ...RESULT, audioItems: [{ fileId: 'f1' }] }, extra: { playAudio } });
    const flip = screen.getByRole('button', { name: /^查看/ });
    const heart = screen.getByRole('button', { name: /^收藏「/ });
    const play = within(container.querySelector('.word-card-front')).getByRole('button', { name: '播放「balay」的發音' });
    expect(flip.contains(heart)).toBe(false);
    expect(flip.contains(play)).toBe(false);
    fireEvent.click(heart);
    fireEvent.keyDown(heart, { key: 'Enter' });
    fireEvent.click(play);
    expect(playAudio).toHaveBeenCalledWith('f1');
    expect(toggleExpand).not.toHaveBeenCalled();
  });

  test('FE3-09：翻到背面後有明確的「返回」按鈕可回到正面', () => {
    const toggleExpand = vi.fn();
    renderCard(true, { toggleExpand });
    fireEvent.click(screen.getByRole('button', { name: '返回「balay」字卡正面' }));
    expect(toggleExpand).toHaveBeenCalledWith('k');
  });

  test('FE3-10：點愛心取消收藏時帶復原提示選項', () => {
    const toggleFavorite = vi.fn();
    renderCard(false, { isFavorited: true, toggleFavorite });
    fireEvent.click(screen.getByRole('button', { name: /^收藏「/ }));
    expect(toggleFavorite).toHaveBeenCalledWith('balay', 1, { undo: true });
  });

  test('FE3-19：詞頻為 0、缺值或非數字時不顯示（沒有孤立的「0」）；正數才顯示', () => {
    const { container, rerender } = renderCard(false, { result: { ...RESULT, frequency: 0 } });
    expect(container.querySelector('.word-frequency-label')).toBeNull();
    expect(container.querySelector('.word-meta').textContent).toBe('');
    rerender(<div />);
    const missing = renderCard(false, { result: { ...RESULT, frequency: undefined } });
    expect(missing.container.querySelector('.word-frequency-label')).toBeNull();
    const str0 = renderCard(false, { result: { ...RESULT, frequency: '0' } });
    expect(str0.container.querySelector('.word-frequency-label')).toBeNull();
    const ok = renderCard(false, { result: { ...RESULT, frequency: 3 } });
    expect(ok.container.querySelector('.word-frequency-label')).not.toBeNull();
  });

  test('FE3-19：播放鈕名稱含詞名；播放失敗時同一顆按鈕變成重試（不消失），按了會重試', () => {
    const retryAudio = vi.fn();
    const result = { ...RESULT, audioItems: [{ fileId: 'f1' }] };
    const { container } = renderCard(false, { result, extra: { failedAudio: new Set(['f1']), retryAudio } });
    const retry = within(container.querySelector('.word-card-front')).getByRole('button', { name: /重試播放「balay」的發音/ });
    fireEvent.click(retry);
    expect(retryAudio).toHaveBeenCalledWith('f1');
  });

  test('FE3-19：播放中顯示「停止播放」並可停止', () => {
    const stopAudio = vi.fn();
    const result = { ...RESULT, audioItems: [{ fileId: 'f1' }] };
    const { container } = renderCard(false, { result, extra: { playingId: 'f1', playingDuration: 2, stopAudio } });
    fireEvent.click(within(container.querySelector('.word-card-front')).getByRole('button', { name: '停止播放「balay」的發音' }));
    expect(stopAudio).toHaveBeenCalled();
  });
});
