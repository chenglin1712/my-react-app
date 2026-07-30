import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SentenceSpeak from './sentenceSpeak';

/** sentenceSpeak.jsx 內嵌了一份獨立的錄音狀態機（沒有共用
 * _game/pronunciation/useAudioRecorder.js），停止錄音時原本只呼叫
 * mediaRecorder.stop()，不會釋放 getUserMedia 拿到的 stream，麥克風錄音中
 * 指示燈會持續亮著。這裡確認停止錄音會真正釋放麥克風。 */
vi.mock('lottie-web', () => ({ default: { loadAnimation: () => ({ addEventListener: vi.fn(), destroy: vi.fn() }) } }));
vi.mock('../../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));
vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('../../utils/correctSound', () => ({ playCorrectSound: vi.fn() }));

class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream;
    this.ondataavailable = null;
    this.onstop = null;
  }
  start() {}
  stop() {
    this.onstop?.();
  }
}

// audio 給非空值：question.tayal.audio 為 falsy 時，元件的 style 三元運算式
// 會傳一個空字串給 style prop（React 要求 style 必須是物件），這是元件既有、
// 跟這裡要測的麥克風釋放無關的另一個問題，測試資料避開它即可。
const QUESTION = { tayal: { sentence: 'balay', audio: 'audio-1' }, answer: 'balay' };

describe('SentenceSpeak 錄音', () => {
  let fakeTracks;

  beforeEach(() => {
    fakeTracks = [{ stop: vi.fn() }];
    window.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => fakeTracks }),
    };
    window.MediaRecorder = FakeMediaRecorder;
    window.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
  });

  test('停止錄音會釋放麥克風的每個 track', async () => {
    const user = userEvent.setup();
    render(<SentenceSpeak question={QUESTION} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(screen.getByLabelText('開始錄音'));
    expect(await screen.findByLabelText('停止錄音')).toBeInTheDocument();

    await user.click(screen.getByLabelText('停止錄音'));

    expect(fakeTracks[0].stop).toHaveBeenCalledTimes(1);
  });
});
