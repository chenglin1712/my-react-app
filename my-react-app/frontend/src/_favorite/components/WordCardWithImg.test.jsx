import { describe, test, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import WordCardWithImg from './WordCardWithImg';

const RESULT = { name: 'balay', explanationItems: [{ chineseExplanation: '真的', sentenceItems: [] }], audioItems: [] };

function renderCard(isExpanded) {
  return render(
    <WordCardWithImg
      keyName="k"
      word="真的"
      result={RESULT}
      isExpanded={isExpanded}
      toggleExpand={vi.fn()}
      toggleFavorite={vi.fn()}
      wordName="balay"
      categoryId={1}
      playAudio={vi.fn()}
      failedAudio={new Set()}
      isFavorited={false}
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
});
