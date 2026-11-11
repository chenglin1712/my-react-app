import { describe, expect, test } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Image as ImageExtension } from '@tiptap/extension-image';
import FontSize from './fontSizeExtension';

// 套件升級（Dependabot）時的煙霧測試：用「真的」TipTap 編輯器（不是 mock），
// 跑筆記編輯器實際用到的延伸套件組合與指令。useNotePages.test.js 把編輯器整個換成假物件，
// 所以升級 @tiptap/* 時只有這支能發現編輯器行為被改壞。
// 延伸套件組合與 useNotePages.js 的 useEditor 設定相同。
function createEditor(content = '<p></p>') {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      FontSize,
      ImageExtension.configure({ HTMLAttributes: { style: 'max-width: 30%; height: auto;' } }),
    ],
    content,
  });
}

describe('筆記編輯器（真實 TipTap）', () => {
  test('載入既有 HTML：文字顏色與字級會保留，圖片網址與樣式不變', () => {
    const editor = createEditor(
      '<p><span style="color: #ff0000; font-size: 20px">紅色大字</span></p>'
      + '<img src="https://res.cloudinary.com/demo/image/upload/a.jpg" alt="示範">',
    );
    const html = editor.getHTML();
    expect(html).toContain('紅色大字');
    expect(html).toMatch(/color:\s*(#ff0000|rgb\(255,\s*0,\s*0\))/i);
    expect(html).toMatch(/font-size:\s*20px/);
    expect(html).toContain('https://res.cloudinary.com/demo/image/upload/a.jpg');
    expect(html).toMatch(/max-width:\s*30%/);
    editor.destroy();
  });

  test('文字樣式指令：粗體、斜體、顏色、字級可以疊加，也能取消', () => {
    const editor = createEditor('<p>範例文字</p>');
    editor.chain().focus().selectAll().toggleBold().toggleItalic().setColor('#0000ff').setFontSize('24px').run();
    let html = editor.getHTML();
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toMatch(/color:\s*(#0000ff|rgb\(0,\s*0,\s*255\))/i);
    expect(html).toMatch(/font-size:\s*24px/);

    editor.chain().focus().selectAll().unsetColor().unsetFontSize().toggleBold().run();
    html = editor.getHTML();
    expect(html).not.toContain('<strong>');
    expect(html).not.toMatch(/font-size:\s*24px/);
    editor.destroy();
  });

  test('插入圖片：setImage 會寫入 img 節點並帶上設定的樣式', () => {
    const editor = createEditor('<p>前文</p>');
    editor.chain().focus('end').setImage({ src: 'https://res.cloudinary.com/demo/image/upload/b.png', alt: '圖' }).run();
    const html = editor.getHTML();
    expect(html).toContain('<img');
    expect(html).toContain('https://res.cloudinary.com/demo/image/upload/b.png');
    expect(html).toMatch(/max-width:\s*30%/);
    editor.destroy();
  });

  test('清單與標題（StarterKit）可正常切換，輸出的 HTML 能再被載入並得到相同結果', () => {
    const editor = createEditor('<p>項目一</p>');
    editor.chain().focus().selectAll().toggleBulletList().run();
    expect(editor.getHTML()).toContain('<ul>');
    editor.chain().focus().selectAll().toggleBulletList().run();   // 取消清單（選取範圍要重新取，所以分開執行）
    editor.chain().focus().selectAll().toggleHeading({ level: 2 }).run();
    expect(editor.getHTML()).toContain('<h2>');

    const html = editor.getHTML();
    const reloaded = createEditor(html);
    expect(reloaded.getHTML()).toBe(html);
    editor.destroy();
    reloaded.destroy();
  });
});
