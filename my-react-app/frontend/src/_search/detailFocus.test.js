import { describe, test, expect, beforeEach } from 'vitest';
import { findDetailFocusTarget, restoreDetailFocus } from './detailFocus';

// 稽核 FE3-15：詳情面板換詞後關閉，焦點回到最後看的那個詞的字卡
const card = (key, label) => `<button class="word-card-toggle" data-word-key="${key}">${label}</button>`;

describe('detailFocus', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul class="list-group" id="exact">${card('a', 'A1')}${card('b', 'B1')}</ul>
      <ul class="list-group" id="fuzzy">${card('a', 'A2')}${card('c', 'C2')}</ul>`;
  });

  test('回到最後看的那個詞，而不是最初點開的那張', () => {
    const origin = document.querySelector('#exact [data-word-key="a"]');
    const target = restoreDetailFocus('b', origin);
    expect(target.textContent).toBe('B1');
    expect(document.activeElement).toBe(target);
  });

  test('同一個 key 出現在兩個區塊時，先找最初點開那張所在的清單', () => {
    const origin = document.querySelector('#fuzzy [data-word-key="c"]');
    expect(findDetailFocusTarget('a', origin).textContent).toBe('A2');
  });

  test('最後的詞已經不在畫面上：退回最初點開的按鈕', () => {
    const origin = document.querySelector('#exact [data-word-key="a"]');
    expect(findDetailFocusTarget('gone', origin)).toBe(origin);
  });

  test('兩個都不在了就不動焦點', () => {
    const detached = document.createElement('button');
    expect(findDetailFocusTarget('gone', detached)).toBeNull();
    expect(restoreDetailFocus('gone', null)).toBeNull();
  });
});
