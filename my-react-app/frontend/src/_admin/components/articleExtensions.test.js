import { describe, expect, test } from 'vitest';
import { Editor } from '@tiptap/core';
import { articleExtensions } from './articleExtensions';

// 與 backend/adminapi/article_doc.py 的 _ALLOWED_ATTRS／_MARK_ATTRS／_CONTAINERS 同步
const ALLOWED_NODES = new Set([
  'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'blockquote', 'callout',
  'horizontalRule', 'hardBreak', 'text', 'image', 'youtube', 'table', 'tableRow', 'tableCell', 'tableHeader',
]);
const ALLOWED_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'link', 'textColor', 'highlight', 'fontSize']);
const NODE_ATTRS = {
  paragraph: ['textAlign'],
  heading: ['level', 'textAlign'],
  orderedList: ['start', 'type'],
  callout: ['tone'],
  taskItem: ['checked'],
  tableCell: ['colspan', 'rowspan', 'colwidth'],
  tableHeader: ['colspan', 'rowspan', 'colwidth'],
  image: ['src', 'alt', 'title', 'align', 'size'],
  youtube: ['videoId', 'title'],
};
const MARK_ATTRS = { link: ['href', 'target', 'rel', 'class', 'title'], textColor: ['color'], highlight: ['color'], fontSize: ['size'] };
const CONTAINERS = {
  doc: ['paragraph', 'heading', 'blockquote', 'horizontalRule', 'image', 'table', 'callout', 'youtube', 'bulletList', 'orderedList', 'taskList'],
  blockquote: ['paragraph', 'heading', 'horizontalRule', 'image', 'bulletList', 'orderedList', 'taskList'],
  callout: ['paragraph', 'bulletList', 'orderedList', 'taskList'],
  listItem: ['paragraph', 'bulletList', 'orderedList'],
  taskItem: ['paragraph', 'bulletList', 'orderedList', 'taskList'],
  table: ['tableRow'],
  tableRow: ['tableCell', 'tableHeader'],
  tableCell: ['paragraph', 'bulletList', 'orderedList'],
  tableHeader: ['paragraph', 'bulletList', 'orderedList'],
};
const CHOICES = {
  textColor: ['red', 'orange', 'green', 'blue', 'purple', 'gray'],
  highlight: ['yellow', 'green', 'blue', 'pink', 'gray'],
  fontSize: ['sm', 'lg', 'xl'],
};

const HTML = `
<h2 data-align="center">大標題</h2><h3>中標題</h3><h4>小標題</h4>
<p data-align="right">一般<strong>粗體</strong><em>斜體</em><u>底線</u><s>刪除線</s>H<sub>2</sub>O m<sup>2</sup><a href="https://example.org/x">連結</a><br>換行</p>
<p><span data-text-color="red">紅字</span><mark data-highlight="yellow">螢光</mark><span data-font-size="lg">大字</span></p>
<ul><li><p>項目</p></li></ul><ol><li><p>編號</p></li></ol>
<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>完成</p></li></ul>
<blockquote><p>引用</p></blockquote>
<aside data-callout data-tone="warning"><p>注意事項</p></aside>
<table><tbody><tr><th><p>欄位</p></th><th><p>內容</p></th></tr><tr><td><p>甲</p></td><td colspan="1"><p>乙</p></td></tr></tbody></table>
<div data-youtube-id="dQw4w9WgXcQ" data-title="示範影片"></div>
<hr>
<img src="https://res.cloudinary.com/demo/image/upload/a.jpg" alt="替代" title="圖說" data-align="center" data-size="md" width="300">
<pre><code>程式碼</code></pre>
`;

function walk(node, visit, parent = null) {
  visit(node, parent);
  (node.content ?? []).forEach((child) => walk(child, visit, node));
}

describe('編輯器輸出符合後端白名單', () => {
  const editor = new Editor({ extensions: articleExtensions, content: HTML });
  const json = editor.getJSON();

  test('只產生白名單內的節點與樣式', () => {
    walk(json, (node) => {
      expect(ALLOWED_NODES.has(node.type), `node ${node.type}`).toBe(true);
      (node.marks ?? []).forEach((mark) => expect(ALLOWED_MARKS.has(mark.type), `mark ${mark.type}`).toBe(true));
    });
  });

  test('各項新功能真的有被保留（不是被默默丟掉）', () => {
    const types = new Set();
    const marks = new Set();
    walk(json, (node) => {
      types.add(node.type);
      (node.marks ?? []).forEach((m) => marks.add(m.type));
    });
    ['table', 'tableHeader', 'tableCell', 'taskList', 'taskItem', 'callout', 'youtube', 'image', 'heading', 'blockquote'].forEach((t) => expect(types.has(t), t).toBe(true));
    ['subscript', 'superscript', 'textColor', 'highlight', 'fontSize', 'link', 'bold'].forEach((m) => expect(marks.has(m), m).toBe(true));
    const aligned = [];
    walk(json, (node) => { if (node.attrs?.textAlign) aligned.push(node.attrs.textAlign); });
    expect(aligned.sort()).toEqual(['center', 'right']);
  });

  test('節點與樣式的屬性不超出白名單（例如圖片不能多出 width／height）', () => {
    walk(json, (node) => {
      const extra = Object.keys(node.attrs ?? {}).filter((key) => !(NODE_ATTRS[node.type] ?? []).includes(key));
      expect(extra, `node ${node.type}`).toEqual([]);
      (node.marks ?? []).forEach((mark) => {
        const markExtra = Object.keys(mark.attrs ?? {}).filter((key) => !(MARK_ATTRS[mark.type] ?? []).includes(key));
        expect(markExtra, `mark ${mark.type}`).toEqual([]);
        if (CHOICES[mark.type]) expect(CHOICES[mark.type]).toContain(Object.values(mark.attrs)[0]);
      });
    });
  });

  test('每個容器只含後端允許的子節點', () => {
    walk(json, (node, parent) => {
      if (parent && CONTAINERS[parent.type]) expect(CONTAINERS[parent.type], `${parent.type} > ${node.type}`).toContain(node.type);
    });
  });

  test('標題只有 2 到 4 級；程式碼區塊被關掉（內容退回一般段落文字）', () => {
    const levels = [];
    walk(json, (node) => { if (node.type === 'heading') levels.push(node.attrs.level); });
    expect(levels.sort()).toEqual([2, 3, 4]);
    expect(JSON.stringify(json)).not.toContain('codeBlock');
  });

  test('不安全的連結網址不會變成連結', () => {
    const e = new Editor({ extensions: articleExtensions, content: '<p><a href="javascript:alert(1)">壞</a></p>' });
    expect(JSON.stringify(e.getJSON())).not.toContain('javascript');
  });

  test('信箱連結保留，帶參數的不保留', () => {
    const e = new Editor({ extensions: articleExtensions, content: '<p><a href="mailto:help@example.org">信</a><a href="mailto:a@b.org?body=x">壞</a></p>' });
    const hrefs = [];
    walk(e.getJSON(), (node) => (node.marks ?? []).forEach((m) => m.type === 'link' && hrefs.push(m.attrs.href)));
    expect(hrefs).toEqual(['mailto:help@example.org']);
  });

  test('貼上時只認固定選項：未知顏色、字級、提示框種類、影片代號不會進文件', () => {
    const e = new Editor({
      extensions: articleExtensions,
      content: '<p><span data-text-color="#ff0000">a</span><span data-font-size="72px">b</span><span style="color:red;font-family:Comic Sans">c</span></p>'
        + '<aside data-callout data-tone="pink"><p>d</p></aside>',
    });
    const text = JSON.stringify(e.getJSON());
    expect(text).not.toContain('#ff0000');
    expect(text).not.toContain('72px');
    expect(text).not.toContain('Comic');
    expect(text).not.toContain('pink');
    expect(text).toContain('"tone":"info"');
  });

  test('結構限制：表格儲存格不能放標題，引用裡不能放表格', () => {
    const e = new Editor({
      extensions: articleExtensions,
      content: '<table><tbody><tr><td><h2>標</h2></td></tr></tbody></table><blockquote><table><tbody><tr><td><p>x</p></td></tr></tbody></table></blockquote>',
    });
    walk(e.getJSON(), (node, parent) => {
      if (parent && CONTAINERS[parent.type]) expect(CONTAINERS[parent.type], `${parent.type} > ${node.type}`).toContain(node.type);
    });
  });
});

// 這份 JSON 同時給後端驗證器再驗一次（backend 對照測試）
export { HTML };
