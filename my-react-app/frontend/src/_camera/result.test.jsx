import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    await waitFor(() => expect(screen.getByText(/完全符合結果/)).toBeInTheDocument());

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      { words: ['balay'], tribe: 'tayal' },
      { headers: {}, timeout: expect.any(Number) },
    );
  });

  test('已登入時會帶 Authorization header 查詢', async () => {
    mockCurrentUser = { getIdToken: vi.fn().mockResolvedValue('fake-token') };
    axios.post.mockResolvedValueOnce(FAKE_RESPONSE);

    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onRestart={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/完全符合結果/)).toBeInTheDocument());

    expect(axios.post).toHaveBeenCalledWith(
      expect.any(String),
      { words: ['balay'], tribe: 'tayal' },
      { headers: { Authorization: 'Bearer fake-token' }, timeout: expect.any(Number) },
    );
  });

  test('回歸測試：快速切換族語時，比較慢的舊族語回應不會蓋掉新族語已經顯示的結果', async () => {
    let resolveTayal;
    axios.post.mockImplementation((url, body) => {
      if (body.tribe === 'tayal') {
        return new Promise((resolve) => { resolveTayal = resolve; });
      }
      return Promise.resolve({
        data: {
          exact_match_results: { cyux: [{ name: 'cyux', explanationItems: [{ chineseExplanation: '看' }] }] },
          fuzzy_match_results: {},
        },
      });
    });

    const { rerender } = render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onRestart={vi.fn()} />);
    rerender(<CameraResultStep selectedWords={['balay']} tribe="bunun" onRestart={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('cyux')).toBeInTheDocument());

    resolveTayal(FAKE_RESPONSE); // 過期的 tayal 回應這時候才回來
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('balay')).not.toBeInTheDocument();
    expect(screen.getByText('cyux')).toBeInTheDocument();
  });

  test('查詢失敗時顯示錯誤訊息並關閉 loading', async () => {
    axios.post.mockRejectedValueOnce({ message: 'Network Error' });

    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onRestart={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/查詢失敗: Network Error/)).toBeInTheDocument());
  });
});

describe('CameraResultStep 的導覽與族語（E-4）', () => {
  beforeEach(() => {
    mockCurrentUser = null;
    axios.post.mockReset();
    axios.post.mockResolvedValue(FAKE_RESPONSE);
  });

  test('「回到選詞」與「重新上傳圖片」是兩個不同的動作', async () => {
    const onBack = vi.fn();
    const onRestart = vi.fn();
    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onTribeChange={vi.fn()} onBack={onBack} onRestart={onRestart} />);
    await screen.findByText('balay');

    fireEvent.click(screen.getAllByRole('button', { name: /回到選詞/ })[0]);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新上傳圖片' }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  test('族語選擇在結果頁：切換會通知上層', async () => {
    const onTribeChange = vi.fn();
    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onTribeChange={onTribeChange} onBack={vi.fn()} onRestart={vi.fn()} />);
    await screen.findByText('balay');

    const group = screen.getByRole('group', { name: '查詢的族語' });
    fireEvent.click(group.querySelectorAll('button')[1]);
    expect(onTribeChange).toHaveBeenCalled();
  });

  test('查詢失敗可以重試，重試會再送一次', async () => {
    axios.post.mockReset();
    axios.post.mockRejectedValueOnce(new Error('Network Error'));
    axios.post.mockResolvedValueOnce(FAKE_RESPONSE);
    render(<CameraResultStep selectedWords={['balay']} tribe="tayal" onTribeChange={vi.fn()} onBack={vi.fn()} onRestart={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('查詢失敗');
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByText('balay')).toBeInTheDocument();
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
