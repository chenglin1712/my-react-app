import { describe, expect, test } from 'vitest';
import { Editor } from '@tiptap/core';
import { createNoteExtensions, upgradeLegacyNoteHtml } from './noteEditorExtensions';

// 套件升級（Dependabot）時的煙霧測試：用「真的」TipTap 編輯器（不是 mock），
// 跑筆記編輯器實際用到的延伸套件組合與指令。useNotePages.test.js 把編輯器整個換成假物件，
// 所以升級 @tiptap/* 時只有這支能發現編輯器行為被改壞。
// 延伸套件組合與 useNotePages.js 共用（noteEditorExtensions.js），不會兩邊各寫一份而不一致。
function createEditor(content = '<p></p>') {
  return new Editor({
    element: document.createElement('div'),
    extensions: createNoteExtensions({ placeholder: '從這裡開始寫' }),
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

  test('P5-4：空白筆記的第一個段落有 is-editor-empty 與引導文字；打了字就沒有', () => {
    const editor = createEditor('<p></p>');
    const first = () => editor.view.dom.querySelector('p');
    expect(first().classList.contains('is-editor-empty')).toBe(true);
    expect(first().getAttribute('data-placeholder')).toBe('從這裡開始寫');
    editor.commands.insertContent('你好');
    expect(first().classList.contains('is-editor-empty')).toBe(false);
    editor.destroy();
  });

  // FE6-01：舊筆記把圖片以 Base64 內嵌。TipTap 3 的 Image 預設 allowBase64:false，載入時圖片會被丟掉，
  // 之後存檔就永久消失。
  test('舊筆記內嵌的 Base64 圖片載入後仍保留，重新載入輸出也不變', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const editor = createEditor(`<p>舊筆記</p><img src="${dataUrl}" alt="舊圖">`);
    const html = editor.getHTML();
    expect(html).toContain(dataUrl);
    const reloaded = createEditor(html);
    expect(reloaded.getHTML()).toBe(html);
    editor.destroy();
    reloaded.destroy();
  });

  // FE6-01b：舊版 contenteditable 會留下 <mark>、<sub>、<sup>，載入後不能被整理掉。
  test('舊筆記的螢光標記與上下標載入後仍保留', () => {
    const editor = createEditor('<p><mark>重點</mark>H<sub>2</sub>O，x<sup>2</sup></p>');
    const html = editor.getHTML();
    expect(html).toContain('<mark>重點</mark>');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
    editor.destroy();
  });

  test('舊版 <font color size> 先轉成 span 樣式，顏色與字級保留；沒有 font 的內容原樣不動', () => {
    const upgraded = upgradeLegacyNoteHtml('<p><font color="#ff0000" size="5">紅字</font></p>');
    expect(upgraded).not.toContain('<font');
    const editor = createEditor(upgraded);
    const html = editor.getHTML();
    expect(html).toContain('紅字');
    expect(html).toMatch(/color:\s*(#ff0000|rgb\(255,\s*0,\s*0\))/i);
    expect(html).toMatch(/font-size:\s*24px/);
    editor.destroy();

    const plain = '<p>沒有舊標籤</p>';
    expect(upgradeLegacyNoteHtml(plain)).toBe(plain);
    expect(upgradeLegacyNoteHtml(undefined)).toBeUndefined();
  });
});
