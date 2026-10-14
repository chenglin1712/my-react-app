import DOMPurify from 'dompurify';

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 檔名不能含的字元換成底線，並限制長度。 */
export function safeFileName(title) {
  const base = Array.from((title || '').trim())
    .map((char) => (char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? '_' : char))
    .join('')
    .slice(0, 60);
  return `${base || '未命名筆記'}.html`;
}

export function buildNoteHtml(note) {
  const title = note?.title?.trim() || '未命名筆記';
  const body = DOMPurify.sanitize(note?.content || '');
  return `<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(title)}</title>\n</head>\n<body>\n<h1>${escapeHtml(title)}</h1>\n${body}\n</body>\n</html>\n`;
}

/**
 * 把一頁筆記存成 .html 檔，給同步失敗、使用者想先把內容帶走的情況用。
 * 內嵌的圖片原樣保留（檔案自己就是完整的）。
 */
export function exportNoteAsHtml(note) {
  const blob = new Blob([buildNoteHtml(note)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(note?.title);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
