import { Mark, mergeAttributes } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Image as ImageExtension } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import FontSize from "./fontSizeExtension";

// 舊版筆記（contenteditable 時期）會留下 <mark>、<sub>、<sup> 與 <font>。TipTap 只認識自己註冊過的
// 標籤，載入時其餘格式會被整理掉，存檔後就永久消失（稽核 FE6-01b）。這三個標記補成最小的自訂 Mark，
// 不新增套件，內容照原樣讀進來、再原樣寫回。
const Highlight = Mark.create({
  name: "highlight",
  parseHTML() { return [{ tag: "mark" }]; },
  renderHTML({ HTMLAttributes }) { return ["mark", mergeAttributes(HTMLAttributes), 0]; },
});

const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML() { return [{ tag: "sub" }]; },
  renderHTML({ HTMLAttributes }) { return ["sub", mergeAttributes(HTMLAttributes), 0]; },
});

const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML() { return [{ tag: "sup" }]; },
  renderHTML({ HTMLAttributes }) { return ["sup", mergeAttributes(HTMLAttributes), 0]; },
});

/**
 * 筆記編輯器的延伸套件組合。正式的編輯器（useNotePages）與真實 TipTap 煙霧測試
 * （noteEditor.real.test.js）共用這一份，避免兩邊各寫一份之後不一致。
 */
export function createNoteExtensions({ placeholder = "" } = {}) {
  return [
    StarterKit,
    TextStyle,
    Color,
    FontSize,
    Highlight,
    Subscript,
    Superscript,
    Placeholder.configure({ placeholder }),
    ImageExtension.configure({
      // 舊版筆記把圖片以 Base64 內嵌（data:image/...）。TipTap 3 的 Image 預設 allowBase64:false，
      // 載入時會直接丟掉這些圖片，之後只要存檔或換頁就永久從筆記刪除（稽核 FE6-01）。
      // 只為了能「讀回」舊內容才開；新插入的圖片仍走 Cloudinary。
      allowBase64: true,
      HTMLAttributes: { style: "max-width: 30%; height: auto;" },
    }),
  ];
}

// <font size="1~7"> 對應的像素大小（瀏覽器對 execCommand fontSize 的慣用對照）
const LEGACY_FONT_PX = { 1: 10, 2: 13, 3: 16, 4: 18, 5: 24, 6: 32, 7: 48 };

/**
 * 把舊版 <font color="..." size="..."> 換成編輯器看得懂的 <span style="color; font-size">。
 * 沒有 <font> 的內容原樣回傳（不經過 DOM 解析），所以對新筆記沒有成本。
 */
export function upgradeLegacyNoteHtml(html) {
  if (typeof html !== "string" || !/<font[\s>]/i.test(html)) return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("font").forEach((font) => {
    const span = document.createElement("span");
    const styles = [];
    const color = font.getAttribute("color");
    const px = LEGACY_FONT_PX[Number.parseInt(font.getAttribute("size"), 10)];
    if (color) styles.push(`color: ${color}`);
    if (px) styles.push(`font-size: ${px}px`);
    if (styles.length) span.setAttribute("style", styles.join("; "));
    while (font.firstChild) span.appendChild(font.firstChild);
    font.replaceWith(span);
  });
  return template.innerHTML;
}
