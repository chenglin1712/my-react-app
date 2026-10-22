import { describe, test, expect, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import useChatRequest from './useChatRequest';
import ChatComposer from './ChatComposer';
import { ChatLog, TypingBubble } from './ChatLog';

describe('useChatRequest', () => {
  test('only one request at a time: begin() returns null while one is in flight', () => {
    const { result } = renderHook(() => useChatRequest());
    let first;
    let second;
    act(() => { first = result.current.begin(); second = result.current.begin(); });
    expect(first).toBeInstanceOf(AbortController);
    expect(second).toBeNull();
    expect(result.current.isPending).toBe(true);
    act(() => result.current.finish());
    expect(result.current.isPending).toBe(false);
    let third;
    act(() => { third = result.current.begin(); });
    expect(third).toBeInstanceOf(AbortController);
  });

  test('abort() cancels the request but leaves the pending state to finish()', () => {
    const { result } = renderHook(() => useChatRequest());
    let controller;
    act(() => { controller = result.current.begin(); });
    act(() => result.current.abort());
    expect(controller.signal.aborted).toBe(true);
    expect(result.current.isPending).toBe(true);
    act(() => result.current.finish());
    expect(result.current.isPending).toBe(false);
  });

  test('discard() aborts and clears the pending state at once, so a new request can start', () => {
    const { result } = renderHook(() => useChatRequest());
    let controller;
    act(() => { controller = result.current.begin(); });
    act(() => result.current.discard());
    expect(controller.signal.aborted).toBe(true);
    expect(result.current.isPending).toBe(false);
    let next;
    act(() => { next = result.current.begin(); });
    expect(next).toBeInstanceOf(AbortController);
  });

  test('unmounting aborts the request in flight, and a late finish() does not touch state', () => {
    const { result, unmount } = renderHook(() => useChatRequest());
    let controller;
    act(() => { controller = result.current.begin(); });
    const { finish } = result.current;
    unmount();
    expect(controller.signal.aborted).toBe(true);
    expect(() => finish()).not.toThrow();
  });
});

describe('ChatComposer', () => {
  const setup = (props = {}) => {
    const onSubmit = vi.fn();
    render(
      <ChatComposer value="hi" onChange={() => {}} onSubmit={onSubmit} label="輸入問題" placeholder="p"
        className="wrap" inputClassName="field" {...props}>
        <button type="button">送出</button>
      </ChatComposer>,
    );
    return { onSubmit, input: screen.getByRole('textbox', { name: '輸入問題' }) };
  };

  test('Enter submits, other keys do not', () => {
    const { onSubmit, input } = setup();
    fireEvent.keyDown(input, { key: 'a' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('Enter that confirms an IME candidate (isComposing or keyCode 229) is not a submit', () => {
    const { onSubmit, input } = setup();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('busy only marks aria-busy and never disables the input, so focus stays put', () => {
    const { input } = setup({ busy: true });
    expect(input).toHaveAttribute('aria-busy', 'true');
    expect(input).not.toBeDisabled();
  });

  test('renders leading content before the input and children after it, with the given classes', () => {
    const { input } = setup({ leading: <button type="button">拍照</button> });
    const wrap = input.parentElement;
    expect(wrap).toHaveClass('wrap');
    expect(input).toHaveClass('field');
    const labels = [...wrap.children].map((el) => el.textContent || el.tagName);
    expect(labels).toEqual(['拍照', 'INPUT', '送出']);
  });
});

describe('ChatLog and TypingBubble', () => {
  test('ChatLog is a polite live log with the shared label', () => {
    render(<ChatLog className="box"><p>訊息</p></ChatLog>);
    const log = screen.getByRole('log', { name: '對話紀錄' });
    expect(log).toHaveClass('box');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveAttribute('aria-relevant', 'additions');
  });

  test('TypingBubble announces to screen readers once and hides the dots', () => {
    const { container } = render(<TypingBubble rowClassName="row" bubbleClassName="bubble typing" indicatorClassName="dots" />);
    expect(screen.getByText('助手正在輸入')).toHaveClass('visually-hidden');
    expect(container.querySelector('.dots')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('.dots span')).toHaveLength(3);
  });
});
