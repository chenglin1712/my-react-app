import { describe, test, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import useHotkeys, { isTypingTarget } from './useHotkeys';

function Probe({ bindings, enabled }) {
  useHotkeys(bindings, { enabled });
  return (
    <div>
      <input aria-label="文字框" />
      <textarea aria-label="文字區" />
      <div contentEditable suppressContentEditableWarning role="textbox" aria-label="編輯器" />
      <button type="button">按鈕</button>
    </div>
  );
}

describe('useHotkeys（P1-8）', () => {
  test('在頁面上按下綁定的鍵會呼叫處理函式並取消預設行為', () => {
    const fn = vi.fn();
    render(<Probe bindings={{ '?': fn }} />);
    const ev = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  test('輸入框、文字區、編輯器裡打字不會觸發', () => {
    const fn = vi.fn();
    const { getByLabelText } = render(<Probe bindings={{ '/': fn }} />);
    fireEvent.keyDown(getByLabelText('文字框'), { key: '/' });
    fireEvent.keyDown(getByLabelText('文字區'), { key: '/' });
    fireEvent.keyDown(getByLabelText('編輯器'), { key: '/' });
    expect(fn).not.toHaveBeenCalled();
  });

  test('按了 Ctrl、Meta、Alt、輸入法組字中、按住重複，都不觸發', () => {
    const fn = vi.fn();
    render(<Probe bindings={{ '/': fn }} />);
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: '/', metaKey: true });
    fireEvent.keyDown(document.body, { key: '/', altKey: true });
    fireEvent.keyDown(document.body, { key: '/', isComposing: true });
    fireEvent.keyDown(document.body, { key: '/', repeat: true });
    expect(fn).not.toHaveBeenCalled();
  });

  test('處理函式回傳 false 時不取消預設行為（這一頁沒有可做的事）', () => {
    render(<Probe bindings={{ '/': () => false }} />);
    const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  test('enabled=false 與卸載後不再觸發', () => {
    const fn = vi.fn();
    const { rerender, unmount } = render(<Probe bindings={{ '?': fn }} enabled={false} />);
    fireEvent.keyDown(document.body, { key: '?' });
    expect(fn).not.toHaveBeenCalled();
    rerender(<Probe bindings={{ '?': fn }} enabled />);
    fireEvent.keyDown(document.body, { key: '?' });
    expect(fn).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('有 aria-modal 彈窗開著時暫停，關掉後恢復', () => {
    const fn = vi.fn();
    render(<Probe bindings={{ '/': fn }} />);
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(fn).not.toHaveBeenCalled();
    modal.remove();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('隱藏或 aria-hidden 的 aria-modal 殘留節點不會讓快捷鍵失效', () => {
    const fn = vi.fn();
    render(<Probe bindings={{ '/': fn }} />);
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    modal.style.display = 'none';
    document.body.appendChild(modal);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(fn).toHaveBeenCalledTimes(1);
    modal.remove();
  });

  test('輸入法 keyCode 229 不觸發；searchbox 角色視為輸入', () => {
    const fn = vi.fn();
    render(<Probe bindings={{ '/': fn }} />);
    fireEvent.keyDown(document.body, { key: '/', keyCode: 229 });
    expect(fn).not.toHaveBeenCalled();
    const sb = document.createElement('div');
    sb.setAttribute('role', 'searchbox');
    expect(isTypingTarget(sb)).toBe(true);
  });

  test('isTypingTarget 判斷', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    const wrap = document.createElement('div');
    wrap.setAttribute('data-hotkeys-ignore', '');
    const child = document.createElement('span');
    wrap.appendChild(child);
    expect(isTypingTarget(child)).toBe(true);
    const btnCombo = document.createElement('button');
    btnCombo.setAttribute('role', 'combobox');
    expect(isTypingTarget(btnCombo)).toBe(false);
  });
});
