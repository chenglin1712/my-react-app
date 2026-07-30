import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WordTranslation from './wordTranslation';
import { createAuthorizedAudio } from '../../utils/authAudio';

/** wordTranslation.jsx 的 playAudio 是 5 個 _quiz_questions 元件各自複製的
 * 其中一份：換音檔／確認作答時停止播放只呼叫 pause()，沒有 revoke，
 * 每切換一次語音就洩漏一個 blob URL。 */
vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));
vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ addEventListener: vi.fn(), destroy: vi.fn() }) } }));
vi.mock('../../utils/correctSound', () => ({ playCorrectSound: vi.fn() }));

function fakeAudio() {
  return { pause: vi.fn(), play: vi.fn().mockResolvedValue(undefined), revokeObjectUrl: vi.fn() };
}

const QUESTION = {
  tayal: { word: 'balay', audio: 'audio-1' },
  options: ['好', '壞'],
  answer: '好',
};

describe('WordTranslation 音檔播放', () => {
  beforeEach(() => {
    createAuthorizedAudio.mockReset();
  });

  test('點確認、停止播放中的題目音檔時會 revoke blob URL', async () => {
    const audio = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const user = userEvent.setup();

    render(<WordTranslation question={QUESTION} selected="好" checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(screen.getByText(QUESTION.tayal.word));
    expect(createAuthorizedAudio).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '確認' }));

    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.revokeObjectUrl).toHaveBeenCalledTimes(1);
  });
});
