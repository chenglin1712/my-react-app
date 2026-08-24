import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import Game_crossword_board from './game_crossword_board';
import { apiGet } from '../../utils/apiClient';

vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn() }));

const VALID_RESPONSE = {
  grid_solution: ['ab', 'c-'],
  legend: [{ number: 1, direction: 'across', start_row: 1, start_col: 1, clue: '線索一' }],
  grid_display: ['1 ', '  '],
};

describe('Game_crossword_board（回歸測試：原本題目還沒載入完成也能取得提交內容）', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  test('題目載入完成前，getSubmissionPayload() 回傳 null，onReadyChange 回報 false', async () => {
    let resolveFetch;
    apiGet.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const ref = createRef();
    const onReadyChange = vi.fn();
    render(<Game_crossword_board ref={ref} tribe="tayal" onReadyChange={onReadyChange} />);

    expect(onReadyChange).toHaveBeenCalledWith(false);
    expect(ref.current.getSubmissionPayload()).toBeNull();

    resolveFetch(VALID_RESPONSE);
    await waitFor(() => expect(onReadyChange).toHaveBeenCalledWith(true));
  });

  test('題目載入完成後，getSubmissionPayload() 回傳完整的提交內容', async () => {
    apiGet.mockResolvedValueOnce(VALID_RESPONSE);
    const ref = createRef();
    render(<Game_crossword_board ref={ref} tribe="tayal" onReadyChange={vi.fn()} />);

    await screen.findByText('橫向題目');

    const payload = ref.current.getSubmissionPayload();
    expect(payload).toEqual({
      user_answers: [['', ''], ['', '-']],
      crossword_solution: VALID_RESPONSE.grid_solution,
      crossword_legend: VALID_RESPONSE.legend,
      crossword_grid_display: VALID_RESPONSE.grid_display,
    });
  });

  test('後端回傳格式不符時顯示錯誤，不會直接把不完整的資料當成正常題目（回歸測試：原本沒有驗證回應形狀，格式錯誤會直接拋例外）', async () => {
    apiGet.mockResolvedValueOnce({ grid_solution: null });
    const ref = createRef();
    render(<Game_crossword_board ref={ref} tribe="tayal" onReadyChange={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('題目載入失敗');
    expect(ref.current.getSubmissionPayload()).toBeNull();
  });

  test('切換族語時，前一次還沒回來的請求即使晚一步解析也不會覆蓋新題目（回歸測試：原本沒有取消機制）', async () => {
    let resolveFirst;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const onReadyChange = vi.fn();
    const { rerender } = render(<Game_crossword_board tribe="tayal" onReadyChange={onReadyChange} />);

    apiGet.mockResolvedValueOnce(VALID_RESPONSE);
    rerender(<Game_crossword_board tribe="amis" onReadyChange={onReadyChange} />);
    await screen.findByText('橫向題目');

    // 泰雅語那次過期的請求現在才回來，不該再把畫面切回「就緒」
    onReadyChange.mockClear();
    resolveFirst({ ...VALID_RESPONSE, legend: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(onReadyChange).not.toHaveBeenCalled();
    expect(screen.getByText(/線索一/)).toBeInTheDocument();
  });
});
