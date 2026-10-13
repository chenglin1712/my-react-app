import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SentenceOrder from './sentenceOrder';
import { ANNOUNCE_EVENT } from '../../utils/announce';

vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));
vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ addEventListener: vi.fn(), destroy: vi.fn() }) } }));
vi.mock('../../utils/correctSound', () => ({ playCorrectSound: vi.fn() }));

// 句子裡有重複的字（"na" 出現兩次）。原本用單字文字本身當 bank/zone 的識別 id：
// 點一個 "na" 會用 `.filter(w => w !== 'na')` 把 bank 裡兩個 "na" 一次全部移除，
// 但只會有一個補進 zone——等於平白遺失一個字。改用位置索引當 id 之後，
// 點其中一個「na」只會移動那一個 token，不會牽動另一個。
const QUESTION = {
  tayal: { sentence: 'na na balay', cn: '真的很真的', audio: null },
  words: [
    { word: 'na', audio: null },
    { word: 'balay', audio: null },
    { word: 'na', audio: null },
  ],
  answer: ['na', 'balay', 'na'],
};

function getWordButtons() {
  return screen.getAllByRole('button').filter((btn) => !btn.textContent.includes('確認') && !btn.getAttribute('aria-label'));
}

// 單詞按鈕改用原生 click（滑鼠、觸控、Enter、Space 都會觸發），不再自己判斷長按
function clickWord(button) {
  fireEvent.click(button);
}

describe('SentenceOrder 重複單字識別（回歸測試：原本用單字文字當 id）', () => {
  test('點擊其中一個重複的字只會移動那一個 token，不會連帶移除另一個相同文字的字', () => {
    render(<SentenceOrder question={QUESTION} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    expect(getWordButtons()).toHaveLength(3);

    clickWord(getWordButtons()[0]); // 點第一個 "na"

    // 三個字都還在（分散在拖放區/單詞庫兩邊），沒有憑空消失
    expect(getWordButtons()).toHaveLength(3);
  });

  test('依序把三個字都移到拖放區、且順序符合正解時，確認後回報正確答案', () => {
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <SentenceOrder question={QUESTION} checked={false} onSelect={onSelect} onConfirm={onConfirm} />
    );

    // 拖放區的字會排在單詞庫前面（先渲染），所以每移動一個字之後，
    // 「單詞庫裡下一個還沒被移走的字」永遠是目前清單中第 zone.length 個位置。
    // 依原始順序（na, balay, na）逐一移動，讓拖放區疊出跟原始順序一樣的排列。
    clickWord(getWordButtons()[0]);
    clickWord(getWordButtons()[1]);
    clickWord(getWordButtons()[2]);

    expect(getWordButtons()).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      result: true,
      userAnswer: ['na', 'balay', 'na'],
    }));
    expect(onConfirm).toHaveBeenCalled();

    // checked 是父層控制的 prop：父層收到 onConfirm 之後才會真的切換到結果畫面
    rerender(<SentenceOrder question={QUESTION} checked={true} onSelect={onSelect} onConfirm={onConfirm} />);
    expect(screen.getByText('正確')).toBeInTheDocument();
  });
});

describe('SentenceOrder 鍵盤操作（審查項 P1-4）', () => {
  const QUESTION_3 = {
    tayal: { sentence: 'a b c', cn: '三個字', audio: null },
    words: [
      { word: 'a', audio: null },
      { word: 'b', audio: null },
      { word: 'c', audio: null },
    ],
    answer: ['a', 'b', 'c'],
  };

  function getZoneWords() {
    // 答案區在 DOM 裡排在單詞庫前面
    return getWordButtons().map((btn) => btn.textContent);
  }

  test('用 Tab 聚焦單詞、按 Enter 就能把它移到答案區', async () => {
    const user = userEvent.setup();
    render(<SentenceOrder question={QUESTION_3} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.tab();
    expect(getWordButtons()[0]).toHaveFocus();
    await user.keyboard('{Enter}');

    // 移動後答案區多了一個字，確認按鈕解除停用
    expect(screen.getByRole('button', { name: '確認' })).toBeEnabled();
  });

  test('用鍵盤把單詞移到答案區後，焦點仍停在那個單詞上，可以接著用方向鍵', async () => {
    const user = userEvent.setup();
    render(<SentenceOrder question={QUESTION_3} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.tab();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toHaveTextContent('a');
    expect(document.activeElement.tagName).toBe('BUTTON');

    await user.tab();
    await user.keyboard('{Enter}');
    // 第二個字也移進答案區，焦點跟著它
    expect(document.activeElement).toHaveTextContent('b');
  });

  test('答案區內按左右方向鍵可以調整順序，並念出新位置', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener(ANNOUNCE_EVENT, handler);
    render(<SentenceOrder question={QUESTION_3} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    // 依序放進答案區：a, b, c
    clickWord(getWordButtons()[0]);
    clickWord(getWordButtons()[1]);
    clickWord(getWordButtons()[2]);
    expect(getZoneWords()).toEqual(['a', 'b', 'c']);

    getWordButtons()[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(getZoneWords()).toEqual(['b', 'a', 'c']);

    await user.keyboard('{ArrowLeft}');
    expect(getZoneWords()).toEqual(['a', 'b', 'c']);

    const messages = handler.mock.calls.map((c) => c[0].detail.message);
    expect(messages).toContain('「a」移到第 2 個');
    window.removeEventListener(ANNOUNCE_EVENT, handler);
  });

  test('到邊界時再按方向鍵不會報錯也不會變動', async () => {
    const user = userEvent.setup();
    render(<SentenceOrder question={QUESTION_3} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);
    clickWord(getWordButtons()[0]);
    clickWord(getWordButtons()[1]);
    getWordButtons()[0].focus();
    await user.keyboard('{ArrowLeft}');
    expect(getZoneWords().slice(0, 2)).toEqual(['a', 'b']);
  });

  test('移動單詞時會念出結果', () => {
    const handler = vi.fn();
    window.addEventListener(ANNOUNCE_EVENT, handler);
    render(<SentenceOrder question={QUESTION_3} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);
    clickWord(getWordButtons()[0]);
    expect(handler.mock.calls[0][0].detail.message).toBe('「a」已放進答案區，第 1 個');
    clickWord(getWordButtons()[0]);
    expect(handler.mock.calls[1][0].detail.message).toBe('「a」已放回單詞庫');
    window.removeEventListener(ANNOUNCE_EVENT, handler);
  });

  test('有發音的單詞旁邊有明確的喇叭按鈕，不再靠長按，且按鈕不會巢狀', () => {
    const withAudio = {
      ...QUESTION_3,
      words: [{ word: 'a', audio: 'a.mp3' }, { word: 'b', audio: null }, { word: 'c', audio: null }],
    };
    const { container } = render(<SentenceOrder question={withAudio} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: '播放「a」的發音' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '播放「b」的發音' })).not.toBeInTheDocument();
    expect(container.querySelector('button button')).toBeNull();
  });

  test('畫面上有鍵盤操作說明', () => {
    render(<SentenceOrder question={QUESTION_3} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText(/方向鍵調整順序/)).toBeInTheDocument();
  });
});
