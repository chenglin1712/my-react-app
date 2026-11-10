import { describe, test, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const announce = vi.hoisted(() => vi.fn());
vi.mock('@utils/announce', () => ({ announce }));

import BotResizeHandle from './BotResizeHandle';

// jsdom 沒有版面，所以替「視窗」假造目前大小；視窗本身設成 1400×900
const setup = (current = { w: 400, h: 620 }) => {
  const overlayRef = createRef();
  const onCommit = vi.fn();
  const Host = () => (
    <div ref={overlayRef}>
      <BotResizeHandle overlayRef={overlayRef} size={null} onCommit={onCommit} />
    </div>
  );
  const view = render(<Host />);
  overlayRef.current.getBoundingClientRect = () => ({ width: current.w, height: current.h });
  return { overlayRef, onCommit, handle: screen.getByRole('button', { name: '調整助手視窗大小' }), view };
};

describe('BotResizeHandle', () => {
  beforeEach(() => {
    announce.mockClear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1400 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  });

  test('點一下：目前是「中」就切到「大」，並通報給報讀器', () => {
    const { handle, onCommit, overlayRef } = setup({ w: 400, h: 620 });
    fireEvent.click(handle);
    expect(onCommit).toHaveBeenCalledWith({ w: 520, h: 760 });
    expect(overlayRef.current.style.getPropertyValue('--bot-w')).toBe('520px');
    expect(announce).toHaveBeenCalledWith('助手視窗大小：大');
  });

  test('鍵盤：左／上變大、右／下變小，每次 16px，不低於下限', () => {
    const { handle, onCommit } = setup({ w: 400, h: 620 });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onCommit).toHaveBeenLastCalledWith({ w: 416, h: 620 });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(onCommit).toHaveBeenLastCalledWith({ w: 400, h: 636 });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenLastCalledWith({ w: 384, h: 620 });
  });

  test('鍵盤縮小不會小於 320×420', () => {
    const { handle, onCommit } = setup({ w: 320, h: 420 });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onCommit).toHaveBeenNthCalledWith(1, { w: 320, h: 420 });
    expect(onCommit).toHaveBeenNthCalledWith(2, { w: 320, h: 420 });
  });

  test('其他按鍵不處理（Tab 照常離開）', () => {
    const { handle, onCommit } = setup();
    fireEvent.keyDown(handle, { key: 'Tab' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('拖曳：往左上拖變大、放開才存；放開後那一次 click 不會再切換預設', () => {
    const { handle, onCommit, overlayRef } = setup({ w: 400, h: 620 });
    fireEvent.pointerDown(handle, { button: 0, clientX: 1000, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 940, clientY: 250, pointerId: 1 });
    expect(overlayRef.current.style.getPropertyValue('--bot-w')).toBe('460px');
    expect(overlayRef.current.style.getPropertyValue('--bot-h')).toBe('670px');
    expect(onCommit).not.toHaveBeenCalled(); // 拖曳中只動 CSS 變數，不寫 state
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ w: 460, h: 670 });
    fireEvent.click(handle);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  test('只是輕微抖動（不到 4px）不算拖曳', () => {
    const { handle, onCommit } = setup();
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 498, clientY: 499, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  test('拖得再大也被視窗夾住（寬最多 視窗寬-32）', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
    const { handle, onCommit } = setup({ w: 400, h: 620 });
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 0, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({ w: 568, h: 620 });
  });

  test('拖曳被系統取消：回到拖曳前的大小、不存、之後第一次點擊仍然有效', () => {
    const { handle, onCommit, overlayRef } = setup({ w: 400, h: 620 });
    overlayRef.current.style.setProperty('--bot-w', '400px');
    fireEvent.pointerDown(handle, { button: 0, clientX: 1000, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 900, clientY: 200, pointerId: 1 });
    expect(overlayRef.current.style.getPropertyValue('--bot-w')).toBe('500px');
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(overlayRef.current.style.getPropertyValue('--bot-w')).toBe('400px');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(handle);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  test('鍵盤調整也會通報新的寬高', () => {
    const { handle } = setup({ w: 400, h: 620 });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(announce).toHaveBeenLastCalledWith('助手視窗大小：寬 416、高 620');
  });

  test('滑鼠右鍵不會開始拖曳', () => {
    const { handle, onCommit } = setup();
    fireEvent.pointerDown(handle, { button: 2, clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
