import DOMPurify from "dompurify";

/**
 * 筆記 HTML 的共用消毒器（稽核 FE-1）。
 *
 * 分享筆記任何登入者都能發佈、任何人都能讀。預設設定的 DOMPurify 會保留 <style>、<form>、
 * <input>，其中 <style> 是全站生效的，可以蓋掉整個介面、做出假的登入或付款面板；外部圖片
 * 還能當追蹤圖。這裡改成白名單：只留 TipTap（StarterKit + TextStyle/Color/FontSize + Image）
 * 與舊版 contenteditable 內容實際會產生的標籤。
 *
 * 取捨：編輯器用 style 屬性存文字顏色與字級，所以不能整個禁掉 style 屬性，改成只放行
 * 少數無害的屬性（顏色、字級、對齊…），且值要通過嚴格格式檢查；position、z-index、url()
 * 等能做版面覆蓋或發外部請求的宣告一律丟掉。class 與 data-* 也不放行，避免借用站內樣式。
 *
 * strictImages：圖片來源只收內嵌的 data:image（png/jpeg/gif/webp）與 Cloudinary 的 https 網址，
 * 擋掉任意外部主機的追蹤圖。分享筆記的讀取端（NoteModal）使用；作者自己的筆記不收緊，
 * 以免自己貼上的外部圖片在存檔時被默默拿掉。
 */

const ALLOWED_TAGS = [
  "p", "br", "hr", "div", "span", "font",
  "strong", "b", "em", "i", "u", "s", "strike", "del", "mark", "sub", "sup",
  "code", "pre", "blockquote",
  "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "a", "img",
];

const ALLOWED_ATTR = ["href", "src", "alt", "title", "style", "start", "color", "size"];

// 即使白名單已經沒有這些，仍明列出來：之後有人放寬 ALLOWED_TAGS 時，它們依然被擋下。
const FORBID_TAGS = [
  "style", "form", "input", "button", "textarea", "select", "option", "link", "meta",
  "iframe", "object", "embed", "svg", "math", "script", "base",
];
const FORBID_ATTR = ["class", "id", "name", "srcset", "formaction", "action"];

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|(?:rgb|hsl)a?\(\s*[\d.%\s,/-]{1,40}\))$/i;
const SIZE_VALUE = /^(\d{1,3}(?:\.\d{1,2})?)(px|pt|em|rem|%)$/i;
// 編輯器最大只有 32px；上限抓到約兩倍，過大的字級可以拿來做假系統提示或洗版
const SIZE_LIMITS = { px: 64, pt: 48, em: 4, rem: 4, "%": 300 };
const STYLE_MAX_LENGTH = 300;

const STYLE_RULES = {
  color: (v) => COLOR_VALUE.test(v),
  "background-color": (v) => COLOR_VALUE.test(v),
  "font-size": (v) => {
    const m = SIZE_VALUE.exec(v);
    return !!m && parseFloat(m[1]) > 0 && parseFloat(m[1]) <= SIZE_LIMITS[m[2].toLowerCase()];
  },
  "text-align": (v) => /^(left|right|center|justify)$/i.test(v),
  "font-weight": (v) => /^(normal|bold|[1-9]00)$/i.test(v),
  "font-style": (v) => /^(normal|italic)$/i.test(v),
  "text-decoration": (v) => /^(none|underline|line-through)$/i.test(v),
};

/** 只保留白名單內、值格式正確的宣告；全部不合格時回傳空字串。 */
export function filterStyle(styleText) {
  if (typeof styleText !== "string" || styleText.length > STYLE_MAX_LENGTH) return "";
  const kept = new Map();
  for (const declaration of styleText.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 1) continue;
    const prop = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim();
    const rule = Object.prototype.hasOwnProperty.call(STYLE_RULES, prop) ? STYLE_RULES[prop] : null;
    // 同一個屬性重複出現時以最後一個合格的為準，輸出每個屬性只有一項
    if (rule && rule(value)) kept.set(prop, value);
  }
  return [...kept].map(([prop, value]) => `${prop}: ${value}`).join("; ");
}

const SAFE_IMAGE_SRC = /^(?:data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+|https:\/\/res\.cloudinary\.com\/[^\s"'<>]*)$/i;

/** 每種模式各用一個獨立的 DOMPurify 實例，hook 才不會互相影響，也不動到全域設定。 */
function createSanitizer({ strictImages }) {
  const purify = DOMPurify(window);

  purify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "style") {
      const clean = filterStyle(data.attrValue);
      if (clean) data.attrValue = clean;
      else data.keepAttr = false;
      return;
    }
    if (strictImages && data.attrName === "src" && node.nodeName === "IMG" && !SAFE_IMAGE_SRC.test(data.attrValue)) {
      data.keepAttr = false;
    }
  });

  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A" && node.hasAttribute("href")) {
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });

  return (html) => purify.sanitize(typeof html === "string" ? html : "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

let defaultSanitizer = null;
let strictSanitizer = null;

/**
 * 消毒筆記 HTML，回傳字串。
 * @param {string} html
 * @param {{ strictImages?: boolean }} [options]
 */
export function sanitizeNoteHtml(html, { strictImages = false } = {}) {
  if (strictImages) {
    strictSanitizer ??= createSanitizer({ strictImages: true });
    return strictSanitizer(html);
  }
  defaultSanitizer ??= createSanitizer({ strictImages: false });
  return defaultSanitizer(html);
}
