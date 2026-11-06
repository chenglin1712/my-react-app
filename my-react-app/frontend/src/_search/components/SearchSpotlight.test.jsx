import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SearchSpotlight from './SearchSpotlight';
import { SUGGESTION_DELAY_MS } from './useSearchSuggestions';
import { apiPost } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiPost: vi.fn() }));

const w = (name, gloss) => ({ name, explanationItems: [{ chineseExplanation: gloss }] });

const setup = (props = {}) => {
  const handleSearch = vi.fn();
  const setQuery = vi.fn();
  const utils = render(<SearchSpotlight query="ba" setQuery={setQuery} handleSearch={handleSearch} loading={false} selectedTribe="泰雅" {...props} />);
  return { handleSearch, setQuery, ...utils };
};

const openSuggestions = async () => {
  const input = screen.getByRole('combobox', { name: '查詢關鍵字' });
  fireEvent.focus(input);
  await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
  return input;
};

describe('SearchSpotlight', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiPost.mockReset();
    apiPost.mockResolvedValue({ exact_match_results: [w('balay', '真的'), w('baqa', '牛')], fuzzy_match_results: {} });
  });
  afterEach(() => vi.useRealTimers());

  test('聚焦並停止輸入後出現建議清單，輸入框是 combobox 並指向 listbox', async () => {
    setup();
    const input = await openSuggestions();
    expect(screen.getByRole('listbox', { name: '查詢建議' })).toBeVisible();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  test('上下鍵移動作用中選項（aria-activedescendant、aria-selected），Enter 直接查那個詞', async () => {
    const { handleSearch, setQuery } = setup();
    const input = await openSuggestions();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setQuery).toHaveBeenCalledWith('baqa');
    expect(handleSearch).toHaveBeenCalledWith(null, 'baqa');
  });

  test('沒有選任何選項時 Enter 就是照輸入的字搜尋', async () => {
    const { handleSearch } = setup();
    const input = await openSuggestions();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handleSearch).toHaveBeenCalledWith(null, null);
  });

  test('Esc 關閉清單，同一段輸入不會再跳出來', async () => {
    setup();
    const input = await openSuggestions();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  test('輸入法組字中按 Enter 不送出', async () => {
    const { handleSearch } = setup();
    const input = await openSuggestions();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(handleSearch).not.toHaveBeenCalled();
  });

  test('輸入法組字中不查建議；組字結束後才查', async () => {
    setup();
    const input = screen.getByRole('combobox', { name: '查詢關鍵字' });
    fireEvent.focus(input);
    fireEvent.compositionStart(input);
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS * 2); });
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    fireEvent.compositionEnd(input);
    await act(async () => { await vi.advanceTimersByTimeAsync(SUGGESTION_DELAY_MS); });
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  test('失焦後清單收起，且在途的舊請求回來也不會再顯示', async () => {
    setup();
    const input = await openSuggestions();
    fireEvent.blur(input);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  test('點建議選項會查那個詞；搜尋鈕在查詢中停用', async () => {
    const { handleSearch } = setup();
    await openSuggestions();
    fireEvent.click(screen.getByRole('option', { name: /balay/ }));
    expect(handleSearch).toHaveBeenCalledWith(null, 'balay');
  });

  test('loading 時搜尋鈕停用', () => {
    setup({ loading: true });
    expect(screen.getByRole('button', { name: '搜尋' })).toBeDisabled();
  });
});
