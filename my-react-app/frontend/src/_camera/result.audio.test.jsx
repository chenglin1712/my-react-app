import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import CameraResultStep from './result';
import { apiPost } from '../../utils/apiClient';

// FE3-06：結果頁發音失敗後，「重試」要真的重播該詞，而不是 retryAudio 沒傳進去而什麼都不做
const audio = vi.hoisted(() => ({
  playAudio: vi.fn(), stopAudio: vi.fn(), retryAudio: vi.fn(),
  playingId: null, playingDuration: 0, failedAudio: new Set(['f1']),
}));
vi.mock('../../hooks/useAudioPlayback', () => ({ default: () => ({ ...audio }) }));
vi.mock('../../utils/apiClient', () => ({ apiPost: vi.fn() }));
vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], toggleFavorite: vi.fn(), error: '' }),
}));

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});

const RESPONSE = {
  exact_match_results: {
    balay: [{ name: 'balay', audioItems: [{ fileId: 'f1' }], explanationItems: [{ chineseExplanation: '好的' }] }],
  },
  fuzzy_match_results: {},
};

describe('CameraResultStep 的發音重試（FE3-06）', () => {
  beforeEach(() => {
    audio.retryAudio.mockReset();
    audio.playAudio.mockReset();
    apiPost.mockReset();
    apiPost.mockResolvedValue(RESPONSE);
  });

  test('清單裡發音失敗的詞按「重試」會用該詞的 fileId 呼叫 retryAudio', async () => {
    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onRestart={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/完全符合結果/)).toBeInTheDocument());
    const retry = await screen.findByRole('button', { name: /重試/ });
    fireEvent.click(retry);
    expect(audio.retryAudio).toHaveBeenCalledWith('f1');
  });
});
