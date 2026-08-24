import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SentenceFill from './sentenceFill';
import { createAuthorizedAudio } from '../../utils/authAudio';

vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));
vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ addEventListener: vi.fn(), destroy: vi.fn() }) } }));
vi.mock('../../utils/correctSound', () => ({ playCorrectSound: vi.fn() }));

const QUESTION = {
  tayal: { sentence: 'balay ___ qwas', audio: 'sentence-audio' },
  options: [{ word: '好' }, { word: '壞' }],
  answer: '好',
};

describe('SentenceFill', () => {
  beforeEach(() => {
    createAuthorizedAudio.mockReset();
  });

  test('點選項目會回報給父層，再點一次同一個選項會取消選擇', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SentenceFill question={QUESTION} selected={null} checked={false} onSelect={onSelect} onConfirm={vi.fn()} />);

    await user.click(screen.getByText('好'));
    expect(onSelect).toHaveBeenLastCalledWith('好');
  });

  test('確認答對時顯示正確、答錯時顯示錯誤，並回報完整的作答結果物件', async () => {
    const onSelect = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<SentenceFill question={QUESTION} selected="好" checked={false} onSelect={onSelect} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: '確認' }));

    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      result: true,
      userAnswer: '好',
      correctAnswer: '好',
    }));
    expect(onConfirm).toHaveBeenCalled();
  });

  test('句子旁邊的播放按鈕是真正的 button，鍵盤/滑鼠都能觸發播放語音', async () => {
    const audio = { pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), revokeObjectUrl: vi.fn() };
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const user = userEvent.setup();
    render(<SentenceFill question={QUESTION} selected={null} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '播放句子語音' }));
    expect(createAuthorizedAudio).toHaveBeenCalledTimes(1);
  });
});
