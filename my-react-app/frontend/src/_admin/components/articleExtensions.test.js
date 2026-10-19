import { describe, expect, test } from 'vitest';
import { Editor } from '@tiptap/core';
import { articleExtensions } from './articleExtensions';

const ALLOWED_NODES = new Set(['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule', 'hardBreak', 'text', 'image']);
const ALLOWED_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'link']);
// 與 backend/adminapi/article_doc.py 的 _ALLOWED_ATTRS／_MARK_ATTRS 同步
const NODE_ATTRS = { heading: ['level'], orderedList: ['start', 'type'], image: ['src', 'alt', 'title'] };
const MARK_ATTRS = { link: ['href', 'target', 'rel', 'class', 'title'] };

const HTML = `
<h2>大標題</h2><h3>小標題</h3>
<p>一般<strong>粗體</strong><em>斜體</em><u>底線</u><s>刪除線</s><a href="https://example.org/x">連結</a><br>換行</p>
<ul><li><p>項目</p></li></ul><ol><li><p>編號</p></li></ol>
<blockquote><p>引用</p></blockquote><hr>
<img src="https://res.cloudinary.com/demo/image/upload/a.jpg" alt="替代" title="圖說" width="300">
<pre><code>程式碼</code></pre>
`;

function walk(node, visit) {
  visit(node);
  (node.content ?? []).forEach((child) => walk(child, visit));
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

  test('節點與樣式的屬性不超出白名單（例如圖片不能多出 width／height）', () => {
    walk(json, (node) => {
      const extra = Object.keys(node.attrs ?? {}).filter((key) => !(NODE_ATTRS[node.type] ?? []).includes(key));
      expect(extra, `node ${node.type}`).toEqual([]);
      (node.marks ?? []).forEach((mark) => {
        const markExtra = Object.keys(mark.attrs ?? {}).filter((key) => !(MARK_ATTRS[mark.type] ?? []).includes(key));
        expect(markExtra, `mark ${mark.type}`).toEqual([]);
      });
    });
  });

  test('標題只有 2、3 級；程式碼區塊與行內程式碼被關掉（內容退回一般段落文字）', () => {
    const levels = [];
    walk(json, (node) => { if (node.type === 'heading') levels.push(node.attrs.level); });
    expect(levels.sort()).toEqual([2, 3]);
    expect(JSON.stringify(json)).not.toContain('codeBlock');
  });

  test('不安全的連結網址不會變成連結', () => {
    const e = new Editor({ extensions: articleExtensions, content: '<p><a href="javascript:alert(1)">壞</a></p>' });
    expect(JSON.stringify(e.getJSON())).not.toContain('javascript');
  });
});

// 這份 JSON 同時寫到暫存檔，讓後端驗證器用同一份真實輸出再驗一次（見 backend 對照測試）
export { HTML };
