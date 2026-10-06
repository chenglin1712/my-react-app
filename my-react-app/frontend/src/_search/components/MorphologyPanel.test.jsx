import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import MorphologyPanel from './MorphologyPanel';
import { apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn() }));

const ok = (over = {}) => ({
  tribe: '阿美語', tribeSlug: 'amis', input: 'cimaopohayay', normalized: 'cimaopohayay',
  token: { status: 'unknown', wordIds: [] }, candidates: [], rulesAvailable: true, admittedRuleCount: 2,
  notes: ['辭典裡沒有這個詞形，也找不到可信的分析結果。'], ...over,
});

const open = () => fireEvent.click(screen.getByRole('button', { name: /詞形分析/ }));
const input = () => screen.getByLabelText('要分析的詞形');

describe('MorphologyPanel（單詞查詢頁的詞形分析）', () => {
  beforeEach(() => {
    // 用大括號、不要回傳值：回傳 mock 函式本身的話，vitest 會把它當成清理函式在每個測試後呼叫。
    apiPost.mockReset();
  });

  test('預設收合，不干擾原本的搜尋；點標題展開、再點收合', () => {
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: /詞形分析/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('要分析的詞形')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(input()).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByLabelText('要分析的詞形')).not.toBeInTheDocument();
  });

  test('標題與提示文字會帶入目前選的族語', () => {
    render(<MorphologyPanel tribeSlug="kavalan" tribeName="噶瑪蘭語" playAudio={vi.fn()} />);
    expect(screen.getByText(/輸入任何噶瑪蘭語詞形/)).toBeInTheDocument();
    open();
    expect(input()).toHaveAttribute('placeholder', expect.stringContaining('噶瑪蘭語'));
  });

  test('按「分析」會用目前族語的 slug 與輸入的詞形呼叫 API，並顯示結果', async () => {
    apiPost.mockResolvedValue(ok());
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    open();
    fireEvent.change(input(), { target: { value: 'cimaopohayay' } });
    fireEvent.click(screen.getByRole('button', { name: '分析' }));

    await waitFor(() => expect(screen.getByText('辭典查無此詞形')).toBeInTheDocument());
    expect(apiPost).toHaveBeenCalledWith(expect.stringContaining('/morphology/analyze'), { tribe: 'amis', word: 'cimaopohayay' }, expect.any(Object));
  });

  test('在輸入框按 Enter 也會分析', async () => {
    apiPost.mockResolvedValue(ok());
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    open();
    fireEvent.change(input(), { target: { value: 'abc' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
  });

  test('輸入法組字中按 Enter（選字）不會送出', () => {
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    open();
    fireEvent.change(input(), { target: { value: 'abc' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('輸入是空白時「分析」按鈕停用，也不會送出', () => {
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    open();
    const go = screen.getByRole('button', { name: '分析' });
    expect(go).toBeDisabled();
    fireEvent.change(input(), { target: { value: '   ' } });
    expect(go).toBeDisabled();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('輸入框限制長度（跟後端的上限一致）', () => {
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    open();
    expect(input()).toHaveAttribute('maxlength', '40');
  });

  test('分析進行中按鈕顯示「分析中…」並停用，避免重複送出', async () => {
    apiPost.mockReturnValue(new Promise(() => {}));
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    open();
    fireEvent.change(input(), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '分析' }));
    const busy = await screen.findByRole('button', { name: '分析中…' });
    expect(busy).toBeDisabled();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  test('後端回錯誤時顯示訊息（role=alert），不顯示過期的結果', async () => {
    apiPost.mockResolvedValueOnce(ok({ input: '舊的結果詞' }));
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    open();
    fireEvent.change(input(), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '分析' }));
    await screen.findByText('舊的結果詞');

    apiPost.mockRejectedValueOnce(new Error('只能輸入族語拼寫用的英文字母、撇號與底線'));
    fireEvent.change(input(), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: '分析' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('只能輸入族語拼寫用的英文字母、撇號與底線');
    expect(screen.queryByText('舊的結果詞')).not.toBeInTheDocument();
  });

  test('換族語時清掉上一個族語的結果與錯誤', async () => {
    apiPost.mockResolvedValue(ok({ input: '阿美的詞' }));
    const { rerender } = render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={vi.fn()} />);
    open();
    fireEvent.change(input(), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '分析' }));
    await screen.findByText('阿美的詞');

    rerender(<MorphologyPanel tribeSlug="tayal" tribeName="泰雅語" playAudio={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('阿美的詞')).not.toBeInTheDocument());
  });

  test('結果裡的音檔按鈕會呼叫搜尋頁傳進來的 playAudio', async () => {
    const playAudio = vi.fn();
    apiPost.mockResolvedValue(ok({
      candidates: [{ source: 'dictionary', confidence: 'dictionary', root: 'filo', rootWordIds: ['w'], audioFileId: 'a1', examples: [] }],
    }));
    render(<MorphologyPanel tribeSlug="amis" tribeName="阿美語" playAudio={playAudio} />);
    open();
    fireEvent.change(input(), { target: { value: 'mafilo' } });
    fireEvent.click(screen.getByRole('button', { name: '分析' }));
    fireEvent.click(await screen.findByRole('button', { name: '播放 filo 的發音' }));
    expect(playAudio).toHaveBeenCalledWith('a1');
  });
});
