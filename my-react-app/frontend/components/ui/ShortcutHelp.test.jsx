import { describe, test, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ShortcutHelp from './ShortcutHelp';
import { SHORTCUTS, openShortcutHelp } from '../../hooks/shortcuts';

describe('ShortcutHelp（P1-8）', () => {
  test('平常不顯示；按「?」開啟，列出清單裡每一個快捷鍵，Esc 關閉', () => {
    render(<ShortcutHelp />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(document.body, { key: '?' });
    const dialog = screen.getByRole('dialog', { name: '鍵盤快捷鍵' });
    SHORTCUTS.forEach(({ label }) => expect(dialog).toHaveTextContent(label));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('頁尾按鈕用的 openShortcutHelp 也能開啟，並有關閉按鈕', () => {
    render(<ShortcutHelp />);
    act(() => { openShortcutHelp(); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '關閉' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('「/」會把焦點移到標記為 data-hotkey-search 的搜尋框', () => {
    render(
      <>
        <input data-hotkey-search aria-label="搜尋" />
        <ShortcutHelp />
      </>,
    );
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByLabelText('搜尋')).toHaveFocus();
  });
});
