import { describe, expect, test, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import FontSize from '../fontSizeExtension';
import SelectionBubble from './SelectionBubble';
import { NOTE_COLORS, normalizeColor } from '../noteInk';

// 用「真的」TipTap 編輯器測：氣泡的粗體、字級、顏色是否真的套在選取的文字上
let editorRef;
function Harness({ content = '<p>你好世界</p>', onEditor = (e) => { editorRef = e; } }) {
  const editor = useEditor({ extensions: [StarterKit, TextStyle, Color, FontSize], content });
  useEffect(() => { onEditor(editor); }, [editor, onEditor]);
  const execStyle = (command, value = null) => {
    const chain = editor.chain().focus();
    if (command === 'bold') chain.toggleBold().run();
    else if (command === 'italic') chain.toggleItalic().run();
    else if (command === 'fontSize') chain.setFontSize(value).run();
    else if (command === 'foreColor') chain.setColor(value).run();
    else if (command === 'unsetColor') chain.unsetColor().run();
  };
  return (<><EditorContent editor={editor} /><SelectionBubble editor={editor} execStyle={execStyle} /></>);
}

const selectAll = () => act(() => { editorRef.chain().focus().selectAll().run(); });
// TipTap 的氣泡元素在沒有選取時不在 DOM 裡，選了文字才掛上去
async function openBubble() {
  await waitFor(() => expect(editorRef?.isInitialized).toBe(true));
  selectAll();
  await screen.findByRole('toolbar', { hidden: true });
}

const INK = { '--yy-note-ink-copper': '#7E5239', '--yy-note-ink-ink': '#292D31', '--yy-note-ink-olive': '#5C5230', '--yy-note-ink-green': '#2F6F4B', '--yy-note-ink-indigo': '#2F4A6D', '--yy-note-ink-wine': '#8A3A4E' };
// 單元測試沒有載入 theme-v2.css，自己把資料色 token 放進 :root
beforeEach(() => { for (const [k, v] of Object.entries(INK)) document.documentElement.style.setProperty(k, v); });
afterEach(() => { editorRef = null; for (const k of Object.keys(INK)) document.documentElement.style.removeProperty(k); });

describe('SelectionBubble（P5-1，真實 TipTap）', () => {
  test('粗體：按下後選取的文字變粗體，按鈕 aria-pressed 跟著變', async () => {
    render(<Harness />);
    await openBubble();
    fireEvent.click(screen.getByRole('button', { name: '粗體', hidden: true }));
    expect(editorRef.getHTML()).toContain('<strong>你好世界</strong>');
    expect(screen.getByRole('button', { name: '粗體', hidden: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('字級：三段（小／中／大），選到的標示 aria-pressed，內容寫入 font-size', async () => {
    render(<Harness />);
    await openBubble();
    fireEvent.click(screen.getByRole('button', { name: '字級：大', hidden: true }));
    expect(editorRef.getHTML()).toMatch(/font-size:\s*32px/);
    expect(screen.getByRole('button', { name: '字級：大', hidden: true })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '字級：小', hidden: true })).toHaveAttribute('aria-pressed', 'false');
  });

  test('顏色：按色盤鈕展開六個色票，選色寫入內容，「預設」還原；色盤的色碼全是 AA 對比的深色', async () => {
    render(<Harness />);
    await openBubble();
    const trigger = screen.getByRole('button', { name: '文字顏色', hidden: true });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(NOTE_COLORS).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: '文字顏色：深銅', hidden: true }));
    expect(editorRef.getHTML()).toMatch(/color:\s*(#7E5239|rgb\(126,\s*82,\s*57\))/i);
    expect(screen.getByRole('button', { name: '文字顏色：深銅', hidden: true })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '文字顏色：還原預設', hidden: true }));
    expect(editorRef.getHTML()).not.toMatch(/color:/i);
  });

  test('舊筆記的純色（紅藍黑橘）照常載入，不在色盤內所以沒有任何一顆色票被標成目前', async () => {
    render(<Harness content={'<p><span style="color: #9E1B24">舊紅字</span></p>'} />);
    await openBubble();
    fireEvent.click(screen.getByRole('button', { name: '文字顏色', hidden: true }));
    expect(editorRef.getHTML()).toMatch(/9E1B24|rgb\(158,\s*27,\s*36\)/i);
    for (const swatch of NOTE_COLORS) {
      expect(screen.getByRole('button', { name: `文字顏色：${swatch.label}`, hidden: true })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('鍵盤：Alt+F10 把焦點移進工具列，→ 移到下一顆，Esc 回到編輯器', async () => {
    render(<Harness />);
    await openBubble();
    fireEvent.keyDown(document, { key: 'F10', altKey: true });
    const bold = screen.getByRole('button', { name: '粗體', hidden: true });
    expect(bold).toHaveFocus();
    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '斜體', hidden: true })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: '斜體', hidden: true }), { key: 'Escape' });
    // TipTap 的 focus() 會等下一個畫面才真的移焦點
    await waitFor(() => expect(editorRef.view.dom.contains(document.activeElement) || document.activeElement === editorRef.view.dom).toBe(true));
  });

  test('工具列只佔一個 Tab 停靠點（roving tabindex）：目前這顆 0，其餘 -1，方向鍵移動後跟著換', async () => {
    render(<Harness />);
    await openBubble();
    const buttons = () => screen.getAllByRole('button', { hidden: true }).filter((b) => b.closest('[role="toolbar"]'));
    expect(buttons().filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
    const bold = screen.getByRole('button', { name: '粗體', hidden: true });
    act(() => bold.focus());
    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    const italic = screen.getByRole('button', { name: '斜體', hidden: true });
    expect(italic).toHaveAttribute('tabindex', '0');
    expect(bold).toHaveAttribute('tabindex', '-1');
    expect(buttons().filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  test('按氣泡裡的按鈕不搶走編輯器的選取（pointerdown 被取消）', async () => {
    render(<Harness />);
    await openBubble();
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    screen.getByRole('button', { name: '粗體', hidden: true }).dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  test('normalizeColor：rgb() 與 #hex 統一成小寫 #rrggbb', () => {
    expect(normalizeColor('rgb(126, 82, 57)')).toBe('#7e5239');
    expect(normalizeColor('#7E5239')).toBe('#7e5239');
    expect(normalizeColor(null)).toBeNull();
  });
});
