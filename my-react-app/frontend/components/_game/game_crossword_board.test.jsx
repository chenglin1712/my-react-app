import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

    expect(await screen.findByRole('alert')).toHaveTextContent('題目暫時載入失敗');
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

describe('Game_crossword_board 的鍵盤操作（E-5，P1-13）', () => {
  const GRID = {
    grid_solution: ['abc', 'd-e'],
    legend: [
      { number: 1, direction: 'across', start_row: 1, start_col: 1, clue: '橫一' },
      { number: 2, direction: 'down', start_row: 1, start_col: 1, clue: '縱二' },
    ],
    grid_display: ['   ', ' - '],
  };

  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(GRID);
  });

  const cell = (label) => screen.getByRole('textbox', { name: new RegExp(label) });

  test('格子名稱帶出橫向／縱向第幾題的第幾格', async () => {
    render(<Game_crossword_board tribe="tayal" />);
    await screen.findByText('橫向題目');
    expect(cell('第 1 列第 1 欄')).toHaveAccessibleName(/橫向第 1 題的第 1 格.*縱向第 2 題的第 1 格/);
    expect(cell('第 1 列第 3 欄')).toHaveAccessibleName(/橫向第 1 題的第 3 格/);
  });

  test('輸入一個字母後自動跳到同方向的下一格', async () => {
    const user = userEvent.setup();
    render(<Game_crossword_board tribe="tayal" />);
    await screen.findByText('橫向題目');
    await user.click(cell('第 1 列第 1 欄'));
    await user.keyboard('a');
    expect(cell('第 1 列第 2 欄')).toHaveFocus();
    await user.keyboard('b');
    expect(cell('第 1 列第 3 欄')).toHaveFocus();
  });

  test('方向鍵移動、跳過黑格；按下鍵後輸入會往下填', async () => {
    const user = userEvent.setup();
    render(<Game_crossword_board tribe="tayal" />);
    await screen.findByText('橫向題目');
    await user.click(cell('第 1 列第 2 欄'));
    await user.keyboard('{ArrowDown}');
    // 第 2 列第 2 欄是黑格，往下沒有可填的格子，焦點留在原地
    expect(cell('第 1 列第 2 欄')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(cell('第 1 列第 1 欄')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(cell('第 2 列第 1 欄')).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowRight}{ArrowRight}');
    expect(cell('第 1 列第 3 欄')).toHaveFocus();
  });

  test('空格按退格會回到上一格並清掉它', async () => {
    const user = userEvent.setup();
    render(<Game_crossword_board tribe="tayal" />);
    await screen.findByText('橫向題目');
    await user.click(cell('第 1 列第 1 欄'));
    await user.keyboard('a');
    expect(cell('第 1 列第 1 欄')).toHaveValue('a');
    await user.keyboard('{Backspace}');
    expect(cell('第 1 列第 1 欄')).toHaveFocus();
    expect(cell('第 1 列第 1 欄')).toHaveValue('');
  });

  test('載入失敗有重試鈕', async () => {
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('x'));
    apiGet.mockResolvedValueOnce(GRID);
    const user = userEvent.setup();
    render(<Game_crossword_board tribe="tayal" />);
    await user.click(await screen.findByRole('button', { name: '重試' }));
    expect(await screen.findByText('橫向題目')).toBeInTheDocument();
  });
});
