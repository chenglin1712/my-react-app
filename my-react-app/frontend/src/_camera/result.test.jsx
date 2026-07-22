import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import CameraResultStep from './result';

vi.mock('axios');

// auth.currentUser 預設是 null（模擬 token 過期／尚未登入），這正是原本
// auth.currentUser?.getIdToken().then(...).catch(...).finally(...) 會整條
// 短路成 undefined、loading 永遠關不掉、也不會顯示任何錯誤的情境（見 result.jsx
// 的 fetchResults 修正說明）。
let mockCurrentUser = null;
vi.mock('../../../firebase', () => ({
  auth: { get currentUser() { return mockCurrentUser; } },
}));

vi.mock('../../src/userServives/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], toggleFavorite: vi.fn(), error: '' }),
}));

const FAKE_RESPONSE = {
  data: {
    exact_match_results: { balay: [{ name: 'balay', explanationItems: [{ chineseExplanation: '好的' }] }] },
    fuzzy_match_results: {},
  },
};

describe('CameraResultStep', () => {
  beforeEach(() => {
    mockCurrentUser = null;
    axios.post.mockReset();
  });

  test('selectedWords 為空時直接顯示錯誤，不呼叫 API', () => {
    render(<CameraResultStep selectedWords={[]} tribe="tayal" onRestart={vi.fn()} />);
    expect(screen.getByText('請選擇至少一個單詞！')).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('currentUser 是 null（token 過期／未登入）時仍會送出查詢並正常關閉 loading，不會卡住', async () => {
    axios.post.mockResolvedValueOnce(FAKE_RESPONSE);

    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onRestart={vi.fn()} />);

    // 修正前：auth.currentUser?.getIdToken() 短路成 undefined，整條 .then/.catch/.finally
    // 都不會執行，這裡的查詢結果永遠不會出現，loading 永遠不會關掉。
    await waitFor(() => expect(screen.getByText(/完全匹配結果/)).toBeInTheDocument());

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      { words: ['balay'], tribe: 'tayal' },
      { headers: {} },
    );
  });

  test('已登入時會帶 Authorization header 查詢', async () => {
    mockCurrentUser = { getIdToken: vi.fn().mockResolvedValue('fake-token') };
    axios.post.mockResolvedValueOnce(FAKE_RESPONSE);

    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onRestart={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/完全匹配結果/)).toBeInTheDocument());

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      { words: ['balay'], tribe: 'tayal' },
      { headers: { Authorization: 'Bearer fake-token' } },
    );
  });

  test('查詢失敗時顯示錯誤訊息並關閉 loading', async () => {
    axios.post.mockRejectedValueOnce({ message: 'Network Error' });

    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onRestart={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/查詢失敗: Network Error/)).toBeInTheDocument());
  });
});
