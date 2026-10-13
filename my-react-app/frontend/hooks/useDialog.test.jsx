import { useRef, useState } from 'react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDialog } from './useDialog';

function Dialog({ onClose, label, withInput = false }) {
  const ref = useRef(null);
  const inputRef = useRef(null);
  useDialog(ref, { onClose, initialFocusRef: withInput ? inputRef : null });
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}>
      {withInput && <input aria-label="輸入" ref={inputRef} />}
      <button type="button">確定</button>
    </div>
  );
}

function Host({ withInput }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>開啟</button>
      {open && <Dialog label="測試視窗" withInput={withInput} onClose={() => setOpen(false)} />}
    </>
  );
}

afterEach(() => {
  document.body.style.overflow = '';
});

describe('useDialog（審查項 P1-5）', () => {
  test('開啟時焦點移進視窗，Esc 關閉並把焦點還給開啟它的按鈕', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const opener = screen.getByRole('button', { name: '開啟' });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  test('可指定初始焦點元素，關閉後仍還給開啟前的按鈕', async () => {
    const user = userEvent.setup();
    render(<Host withInput />);
    const opener = screen.getByRole('button', { name: '開啟' });
    await user.click(opener);
    expect(screen.getByLabelText('輸入')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  test('開啟時鎖住背景捲動，關閉後還原', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'scroll';
    render(<Host />);
    await user.click(screen.getByRole('button', { name: '開啟' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('scroll');
  });

  test('疊著兩個視窗時，Esc 只關最上面那個', async () => {
    const user = userEvent.setup();
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(<><Dialog label="下層" onClose={closeBottom} /><Dialog label="上層" onClose={closeTop} /></>);
    await user.keyboard('{Escape}');
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });

  test('輸入法組字中的 Esc 不會關閉視窗', () => {
    const onClose = vi.fn();
    render(<Dialog label="測試視窗" onClose={onClose} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true });
    document.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('useDialog 疊層與捲動鎖（Codex 審查補測）', () => {
  function Stack() {
    const [top, setTop] = useState(true);
    const [bottom, setBottom] = useState(true);
    return (
      <>
        {bottom && <Dialog label="下層" onClose={() => setBottom(false)} />}
        {top && <Dialog label="上層" onClose={() => setTop(false)} />}
      </>
    );
  }

  test('兩次 Esc 依序關閉上層、下層，捲動鎖到最後一層關閉才解除', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = 'auto';
    render(<Stack />);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '上層' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '下層' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('auto');
  });
});
