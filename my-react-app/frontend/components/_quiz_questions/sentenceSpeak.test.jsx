import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SentenceSpeak from './sentenceSpeak';

/** sentenceSpeak.jsx 內嵌了一份獨立的錄音狀態機（沒有共用
 * _game/pronunciation/useAudioRecorder.js）。這裡涵蓋：停止錄音會真正釋放
 * 麥克風、錄音的 blob URL 會在重新錄音/unmount 時釋放、要求麥克風權限被拒
 * 時會顯示錯誤而不是丟出未處理的 rejection。 */
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

const QUESTION = { tayal: { sentence: 'balay', audio: 'audio-1' }, answer: 'balay' };

describe('SentenceSpeak 錄音', () => {
  let fakeTracks;
  let revokeObjectURL;

  beforeEach(() => {
    fakeTracks = [{ stop: vi.fn() }];
    window.navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => fakeTracks }),
    };
    window.MediaRecorder = FakeMediaRecorder;
    window.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
    revokeObjectURL = vi.fn();
    window.URL.revokeObjectURL = revokeObjectURL;
  });

  test('停止錄音會釋放麥克風的每個 track', async () => {
    const user = userEvent.setup();
    render(<SentenceSpeak question={QUESTION} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(screen.getByLabelText('開始錄音'));
    expect(await screen.findByLabelText('停止錄音')).toBeInTheDocument();

    await user.click(screen.getByLabelText('停止錄音'));

    expect(fakeTracks[0].stop).toHaveBeenCalledTimes(1);
  });

  test('重新錄音時會 revoke 上一段錄音的 blob URL', async () => {
    const user = userEvent.setup();
    render(<SentenceSpeak question={QUESTION} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(screen.getByLabelText('開始錄音'));
    await user.click(await screen.findByLabelText('停止錄音'));
    expect(await screen.findByText('重新錄音')).toBeInTheDocument();

    await user.click(screen.getByText('重新錄音'));

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  test('unmount 時會釋放麥克風並 revoke 錄音的 blob URL', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SentenceSpeak question={QUESTION} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(screen.getByLabelText('開始錄音'));
    await user.click(await screen.findByLabelText('停止錄音'));

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  test('要求麥克風權限被拒絕時顯示錯誤訊息，而不是丟出未處理的 rejection', async () => {
    window.navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const user = userEvent.setup();
    render(<SentenceSpeak question={QUESTION} checked={false} onSelect={vi.fn()} onConfirm={vi.fn()} />);

    await user.click(screen.getByLabelText('開始錄音'));

    expect(await screen.findByRole('alert')).toHaveTextContent('無法使用麥克風');
  });
});
