import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SentenceOrder from './sentenceOrder';

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
  return screen.getAllByRole('button').filter((btn) => !btn.textContent.includes('確認'));
}

// SortableWord 用 mousedown+setTimeout(500ms)+mouseup 判斷長按/短按移動：
// 用 fireEvent 直接在同一個 tick 內送出 mousedown/mouseup，兩者間不會真的
// 經過 500ms，不用依賴系統負載夠低、真實計時器不會搶先觸發長按。
function clickWord(button) {
  fireEvent.mouseDown(button, { clientX: 0, clientY: 0 });
  fireEvent.mouseUp(button, { clientX: 0, clientY: 0 });
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
