import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioPlayButton from './AudioPlayButton';
import { ANNOUNCE_EVENT } from '../../utils/announce';

const listen = () => {
  const messages = [];
  const handler = (e) => messages.push(e.detail);
  window.addEventListener(ANNOUNCE_EVENT, handler);
  return { messages, off: () => window.removeEventListener(ANNOUNCE_EVENT, handler) };
};

describe('AudioPlayButton（P2-5、P2-6）', () => {
  test('閒置：播放鈕，點了呼叫 onPlay', () => {
    const onPlay = vi.fn();
    render(<AudioPlayButton name="babaw" onPlay={onPlay} />);
    fireEvent.click(screen.getByRole('button', { name: '播放「babaw」的發音' }));
    expect(onPlay).toHaveBeenCalled();
  });

  test('播放中：名稱變成「停止播放」，點了呼叫 onStop；有環形進度與波形，長度跟音檔一樣', () => {
    const onStop = vi.fn();
    const { container } = render(<AudioPlayButton name="babaw" playing duration={2.5} onStop={onStop} />);
    const btn = screen.getByRole('button', { name: '停止播放「babaw」的發音' });
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalled();
    expect(container.querySelector('.yy-audio-wave')).not.toBeNull();
    const fill = container.querySelector('.yy-audio-ring-fill');
    expect(fill).toHaveClass('has-duration');
    expect(fill.style.getPropertyValue('--yy-audio-dur')).toBe('2.5s');
  });

  test('不知道長度時環不動，只留波形', () => {
    const { container } = render(<AudioPlayButton name="x" playing duration={0} />);
    expect(container.querySelector('.yy-audio-ring-fill')).not.toHaveClass('has-duration');
    expect(container.querySelector('.yy-audio-wave')).not.toBeNull();
  });

  test('三種狀態是同一顆按鈕節點（換態不卸載，鍵盤焦點不會掉）', () => {
    const { rerender } = render(<AudioPlayButton name="x" />);
    const btn = screen.getByRole('button');
    btn.focus();
    rerender(<AudioPlayButton name="x" playing duration={2} />);
    expect(screen.getByRole('button')).toBe(btn);
    rerender(<AudioPlayButton name="x" failed />);
    expect(screen.getByRole('button')).toBe(btn);
    expect(document.activeElement).toBe(btn);
    rerender(<AudioPlayButton name="x" />);
    expect(screen.getByRole('button')).toBe(btn);
  });

  test('失敗：不消失，顯示可讀文字與重試鈕（showStatus）；點了呼叫 onRetry', () => {
    const onRetry = vi.fn();
    render(<AudioPlayButton name="babaw" failed showStatus onRetry={onRetry} />);
    expect(screen.getByText('發音載入失敗')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: '發音載入失敗，重試播放「babaw」的發音' });
    expect(retry).toHaveTextContent('重試');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalled();
  });

  test('失敗（詞卡上不放整行說明）：重試鈕仍有可見的「重試」字，不只靠圖示或顏色', () => {
    render(<AudioPlayButton name="babaw" failed />);
    const retry = screen.getByRole('button', { name: '發音載入失敗，重試播放「babaw」的發音' });
    expect(retry).toHaveTextContent('重試');
    expect(screen.queryByText('發音載入失敗')).not.toBeInTheDocument();
  });

  test('狀態變化才公告：播放中、失敗（插話）；剛掛上來不補公告', () => {
    const { messages, off } = listen();
    const { rerender } = render(<AudioPlayButton name="babaw" />);
    expect(messages).toHaveLength(0);
    rerender(<AudioPlayButton name="babaw" playing />);
    expect(messages.at(-1)).toEqual({ message: '正在播放「babaw」', assertive: false });
    rerender(<AudioPlayButton name="babaw" failed />);
    expect(messages.at(-1)).toEqual({ message: '「babaw」的發音載入失敗，可以按重試', assertive: true });
    off();
    const again = listen();
    render(<AudioPlayButton name="mounted-failed" failed />);
    expect(again.messages).toHaveLength(0);
    again.off();
  });
});
