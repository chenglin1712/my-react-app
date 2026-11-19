import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TrueFalseDetail } from './reviewQuestionRenderers';

// F18：複習頁的播放鈕一次只播一段；離開題目時停掉。
const players = [];

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.paused = false;
    this.pause = vi.fn(() => { this.paused = true; });
    this.play = vi.fn(() => Promise.resolve());
    players.push(this);
  }
}

const item = (audio) => ({ audio, question_ab: 'ab', question_ch: 'ch' });
const show = (audio) => render(<TrueFalseDetail item={item(audio)} userAnswerNum={1} correctAnswerNum={1} />);

describe('複習頁播放鈕（F18）', () => {
  beforeEach(() => {
    players.length = 0;
    vi.stubGlobal('Audio', FakeAudio);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('按一下就播放這段音訊', () => {
    show('/a.mp3');
    fireEvent.click(screen.getByRole('button', { name: '播放音訊' }));
    expect(players).toHaveLength(1);
    expect(players[0].src).toBe('/a.mp3');
    expect(players[0].play).toHaveBeenCalledTimes(1);
  });

  test('連點：新的一段開始前，上一段先停掉，不會疊著播', () => {
    show('/a.mp3');
    const button = screen.getByRole('button', { name: '播放音訊' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(players).toHaveLength(3);
    expect(players[0].pause).toHaveBeenCalledTimes(1);
    expect(players[1].pause).toHaveBeenCalledTimes(1);
    expect(players[2].pause).not.toHaveBeenCalled();             // 只有最後一段還在播
    expect(players.filter((p) => !p.paused)).toHaveLength(1);
  });

  test('離開這一題（元件卸載）時，正在播的音訊會停掉', () => {
    const { unmount } = show('/a.mp3');
    fireEvent.click(screen.getByRole('button', { name: '播放音訊' }));
    unmount();
    expect(players[0].pause).toHaveBeenCalledTimes(1);
  });

  test('沒按過播放就離開：不會去停別人的音訊', () => {
    const first = show('/a.mp3');
    fireEvent.click(screen.getByRole('button', { name: '播放音訊' }));
    const second = show('/b.mp3');          // 另一個沒按過的播放鈕
    second.unmount();
    expect(players[0].pause).not.toHaveBeenCalled();
    first.unmount();
    expect(players[0].pause).toHaveBeenCalledTimes(1);
  });

  test('在別處按播放時，這個按鈕放的音訊也會停掉（全頁一次只播一段）', () => {
    const first = show('/a.mp3');
    const second = show('/b.mp3');
    // render 的查詢是綁在整個 document.body 上，要用 within 限定在各自的容器，才真的是兩個不同的按鈕
    fireEvent.click(within(first.container).getByRole('button', { name: '播放音訊' }));
    fireEvent.click(within(second.container).getByRole('button', { name: '播放音訊' }));
    expect(players).toHaveLength(2);
    expect(players[0].src).toBe('/a.mp3');
    expect(players[1].src).toBe('/b.mp3');
    expect(players[0].pause).toHaveBeenCalledTimes(1);
    expect(players[1].pause).not.toHaveBeenCalled();
  });

  test('播放被瀏覽器拒絕時不會丟出未處理的錯誤', async () => {
    class RejectingAudio extends FakeAudio {
      constructor(src) { super(src); this.play = vi.fn(() => Promise.reject(new Error('NotAllowedError'))); }
    }
    vi.stubGlobal('Audio', RejectingAudio);
    show('/a.mp3');
    fireEvent.click(screen.getByRole('button', { name: '播放音訊' }));
    await Promise.resolve();
    expect(players[0].play).toHaveBeenCalled();
  });

  test('沒有音訊檔時不顯示播放鈕', () => {
    show(null);
    expect(screen.queryByRole('button', { name: '播放音訊' })).not.toBeInTheDocument();
  });
});
