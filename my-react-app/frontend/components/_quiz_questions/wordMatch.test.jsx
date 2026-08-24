import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WordMatch from './wordMatch';

vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));
vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ addEventListener: vi.fn(), destroy: vi.fn() }) } }));
vi.mock('../../utils/correctSound', () => ({ playCorrectSound: vi.fn() }));

// 兩組配對的中文翻譯剛好相同（現實中常見：同義詞、多音字）。原本用 cn/
// tayal.word 文字本身當配對識別，這種情況下會分不出使用者選的是哪一組；
// 這裡改用配對在題目裡的順序（index）當 id 來源，兩組配對就不會互相干擾。
const QUESTION = {
  pairs: [
    { cn: '你好', tayal: { word: 'lokah', audio: null } },
    { cn: '你好', tayal: { word: 'balay', audio: null } },
  ],
};

describe('WordMatch 配對識別（回歸測試：原本用中文/泰雅語文字本身當 key）', () => {
  let randomSpy;

  beforeEach(() => {
    // 固定 Math.random 讓 Fisher–Yates shuffle 的結果可預期：
    // shuffle([0,1]) 在這個條件下一定回傳 [1,0]。
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    randomSpy.mockRestore();
  });

  test('依照配對 id（而非文字）判斷正確配對，即使兩組配對的中文翻譯相同', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <WordMatch question={QUESTION} onSelect={onSelect} onConfirm={vi.fn()} />
    );

    const leftButtons = container.querySelectorAll('.left button');
    const rightButtons = container.querySelectorAll('.right button');
    expect(rightButtons[0]).toHaveTextContent('balay');

    await user.click(leftButtons[0]); // 第一組「你好」按鈕，對應 id 1（balay 那組）
    await user.click(rightButtons[0]); // 同樣是 id 1 的 balay
    // 全部配對完成才會呼叫 onSelect，所以要把第二組（id 0）也配對完
    await user.click(leftButtons[1]);
    await user.click(rightButtons[1]);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ result: true }));
  });

  test('依照配對 id 判斷錯誤配對，整題結束並顯示對應那一組的正確答案', async () => {
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <WordMatch question={QUESTION} onSelect={onSelect} onConfirm={onConfirm} />
    );

    const leftButtons = container.querySelectorAll('.left button');
    const rightButtons = container.querySelectorAll('.right button');

    await user.click(leftButtons[0]); // id 1
    await user.click(rightButtons[1]); // id 0（lokah，屬於另一組配對，是錯誤配對）

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ result: false }));
    expect(onConfirm).toHaveBeenCalled();
    expect(screen.getByText('錯誤')).toBeInTheDocument();
    // 錯誤訊息要對應「使用者選的那一組（id 1）」的正確答案 balay，
    // 不是文字比對可能誤判成的另一組 lokah。
    expect(screen.getByText((_, el) => el.textContent === '你好 → 正解是 balay')).toBeInTheDocument();
  });

  test('全部配對正確時顯示完成訊息', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <WordMatch question={QUESTION} onSelect={vi.fn()} onConfirm={vi.fn()} />
    );

    const leftButtons = container.querySelectorAll('.left button');
    const rightButtons = container.querySelectorAll('.right button');

    await user.click(leftButtons[0]); // id 1
    await user.click(rightButtons[0]); // id 1 → 正確
    await user.click(leftButtons[1]); // id 0
    await user.click(rightButtons[1]); // id 0 → 正確

    expect(screen.getByText('全部配對正確')).toBeInTheDocument();
  });
});
