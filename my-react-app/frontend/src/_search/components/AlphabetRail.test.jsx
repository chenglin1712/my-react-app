import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AlphabetRail from './AlphabetRail';

const LETTERS = ['a', 'b', 'c', "'"];

describe('AlphabetRail（P2-3）', () => {
  test('沒有字母時不顯示', () => {
    const { container } = render(<AlphabetRail letters={[]} onJump={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('每個字母都是有名稱的按鈕，整列是 navigation', () => {
    render(<AlphabetRail letters={LETTERS} onJump={vi.fn()} />);
    expect(screen.getByRole('navigation', { name: '字母捷徑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '跳到 b 開頭的詞' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  test('整列只有一個 Tab 停靠點，上下鍵與 Home／End 移動焦點', () => {
    render(<AlphabetRail letters={LETTERS} onJump={vi.fn()} />);
    const btns = screen.getAllByRole('button');
    expect(btns.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    btns[0].focus();
    fireEvent.keyDown(btns[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(btns[1]);
    fireEvent.keyDown(btns[1], { key: 'End' });
    expect(document.activeElement).toBe(btns[3]);
    fireEvent.keyDown(btns[3], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(btns[3]);
    fireEvent.keyDown(btns[3], { key: 'Home' });
    expect(document.activeElement).toBe(btns[0]);
  });

  test('沒有 pointer 事件的 click（鍵盤、螢幕閱讀器啟動）一律提交並把焦點交給那個詞，不管 detail 是多少', () => {
    const onJump = vi.fn();
    render(<AlphabetRail letters={LETTERS} onJump={onJump} />);
    const b = screen.getByRole('button', { name: '跳到 b 開頭的詞' });
    fireEvent.click(b, { detail: 0 });
    expect(onJump).toHaveBeenLastCalledWith('b', { focus: true, commit: true });
    fireEvent.click(b, { detail: 1 });
    expect(onJump).toHaveBeenCalledTimes(2);
  });

  test('指標點按：pointerdown 預覽、pointerup 提交一次，緊接著合成的 click 不重複', () => {
    vi.useFakeTimers();
    const onJump = vi.fn();
    const { container } = render(<AlphabetRail letters={LETTERS} onJump={onJump} />);
    const list = container.querySelector('.alpha-list');
    list.getBoundingClientRect = () => ({ top: 0, height: 400, left: 0, right: 44, bottom: 400, width: 44 });
    const b = screen.getByRole('button', { name: '跳到 b 開頭的詞' });
    fireEvent.pointerDown(b, { clientY: 140, pointerId: 1, button: 0 });
    expect(onJump).toHaveBeenLastCalledWith('b', { focus: false, commit: false });
    fireEvent.pointerUp(b, { clientY: 140, pointerId: 1 });
    expect(onJump).toHaveBeenLastCalledWith('b', { focus: false, commit: true });
    fireEvent.click(b, { detail: 1 });
    expect(onJump).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
    fireEvent.click(b, { detail: 0 });
    expect(onJump).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  test('切換族語後字母變少，Tab 停靠點仍在範圍內', () => {
    const { rerender } = render(<AlphabetRail letters={['a', 'b', 'c', 'd']} onJump={vi.fn()} />);
    const btns = screen.getAllByRole('button');
    btns[3].focus();
    rerender(<AlphabetRail letters={['a', 'b']} onJump={vi.fn()} />);
    expect(screen.getAllByRole('button').filter((x) => x.tabIndex === 0)).toHaveLength(1);
  });

  test('手指／滑鼠在列上按下與滑動：依位置跳字母，只捲動不搶焦點，放開後浮出的字母消失', () => {
    const onJump = vi.fn();
    const { container } = render(<AlphabetRail letters={LETTERS} onJump={onJump} />);
    const list = container.querySelector('.alpha-list');
    list.getBoundingClientRect = () => ({ top: 0, height: 400, left: 0, right: 44, bottom: 400, width: 44 });
    list.setPointerCapture = vi.fn();
    list.hasPointerCapture = () => true;
    list.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(list, { clientY: 10, pointerId: 1 });
    expect(onJump).toHaveBeenLastCalledWith('a', { focus: false, commit: false });
    expect(container.querySelector('.alpha-bubble')).toHaveTextContent('a');
    fireEvent.pointerMove(list, { clientY: 250, pointerId: 1 });
    expect(onJump).toHaveBeenLastCalledWith('c', { focus: false, commit: false });
    const calls = onJump.mock.calls.length;
    fireEvent.pointerMove(list, { clientY: 260, pointerId: 1 }); // 仍在 c：不重複跳
    expect(onJump.mock.calls.length).toBe(calls);
    fireEvent.pointerMove(list, { clientY: 399, pointerId: 1 });
    expect(onJump).toHaveBeenLastCalledWith("'", { focus: false, commit: false });
    // 滑動途中沒有任何一次是提交
    expect(onJump.mock.calls.every(([, o]) => o.commit === false)).toBe(true);
    fireEvent.pointerUp(list, { pointerId: 1 });
    expect(onJump).toHaveBeenLastCalledWith("'", { focus: false, commit: true });
    expect(container.querySelector('.alpha-bubble')).toBeNull();
  });
});
