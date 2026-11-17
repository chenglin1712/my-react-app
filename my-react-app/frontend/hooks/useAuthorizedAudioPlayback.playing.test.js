import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useAuthorizedAudioPlayback from './useAuthorizedAudioPlayback';
import { createAuthorizedAudio } from '../utils/authAudio';

vi.mock('../utils/authAudio', () => ({ createAuthorizedAudio: vi.fn() }));

const fakeAudio = (duration = 3) => ({
  duration,
  pause: vi.fn(),
  play: vi.fn().mockResolvedValue(undefined),
  revokeObjectUrl: vi.fn(),
  onplay: null, onended: null, onerror: null, onloadedmetadata: null,
});

describe('useAuthorizedAudioPlayback 的播放中與重試（P2-6）', () => {
  beforeEach(() => { createAuthorizedAudio.mockClear(); });

  test('播放中：playingId 是那個音檔、playingDuration 是長度；播完回到 null', async () => {
    const audio = fakeAudio(2.4);
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const { result } = renderHook(() => useAuthorizedAudioPlayback());
    await act(async () => { await result.current.playAudio('f1'); });
    act(() => audio.onplay());
    expect(result.current.playingId).toBe('f1');
    expect(result.current.playingDuration).toBe(2.4);
    act(() => audio.onended());
    expect(result.current.playingId).toBeNull();
  });

  test('長度未知（Infinity／NaN）時記為 0，不會畫出壞掉的環', async () => {
    const audio = fakeAudio(Infinity);
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const { result } = renderHook(() => useAuthorizedAudioPlayback());
    await act(async () => { await result.current.playAudio('f1'); });
    act(() => audio.onplay());
    expect(result.current.playingDuration).toBe(0);
  });

  test('暫停（stopAudio）：playingId 清掉並暫停音檔', async () => {
    const audio = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    const { result } = renderHook(() => useAuthorizedAudioPlayback());
    await act(async () => { await result.current.playAudio('f1'); });
    act(() => audio.onplay());
    act(() => result.current.stopAudio());
    expect(result.current.playingId).toBeNull();
    expect(audio.pause).toHaveBeenCalled();
  });

  test('失敗：記進 failedAudio、playingId 為 null；重試會把它拿掉並再播一次，成功後不再是失敗', async () => {
    createAuthorizedAudio.mockRejectedValueOnce(new Error('HTTP 500'));
    const { result } = renderHook(() => useAuthorizedAudioPlayback());
    await act(async () => { await result.current.playAudio('f1'); });
    expect(result.current.failedAudio.has('f1')).toBe(true);
    expect(result.current.playingId).toBeNull();

    // 一般播放會略過失敗過的音檔
    await act(async () => { await result.current.playAudio('f1'); });
    expect(createAuthorizedAudio).toHaveBeenCalledTimes(1);

    const audio = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(audio);
    await act(async () => { await result.current.retryAudio('f1'); });
    expect(createAuthorizedAudio).toHaveBeenCalledTimes(2);
    expect(result.current.failedAudio.has('f1')).toBe(false);
    act(() => audio.onplay());
    expect(result.current.playingId).toBe('f1');
  });

  test('重試又失敗會重新被記成失敗', async () => {
    createAuthorizedAudio.mockImplementation(async () => { throw new Error('HTTP 500'); });
    const { result } = renderHook(() => useAuthorizedAudioPlayback());
    await act(async () => { await result.current.playAudio('f1'); });
    await act(async () => { await result.current.retryAudio('f1'); });
    expect(result.current.failedAudio.has('f1')).toBe(true);
  });

  test('改播另一個音檔：playingId 不會留著舊的', async () => {
    const a = fakeAudio();
    const b = fakeAudio();
    createAuthorizedAudio.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    const { result } = renderHook(() => useAuthorizedAudioPlayback());
    await act(async () => { await result.current.playAudio('f1'); });
    act(() => a.onplay());
    await act(async () => { await result.current.playAudio('f2'); });
    expect(result.current.playingId).toBeNull(); // 新的還沒開始播
    act(() => b.onplay());
    expect(result.current.playingId).toBe('f2');
  });
});
