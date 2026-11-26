/**
 * 統一的 Cloudinary 上傳工具（FE-3）。
 *
 * 原本這段「組 FormData → fetch api.cloudinary.com → 檢查 response.ok →
 * 取 result.secure_url」的邏輯在 10 支檔案裡各自複製了一份
 * （editProfile／registerForm／HomepageConfig／QuizChoice／QuizTrueFalse／
 * AnnouncementEditor／MediaUploadField／UserDetail／UserCreate／_note），
 * 而且不是完全一致：端點有 `image/upload`、`image/upload/f_auto,q_auto`、
 * `video/upload` 三種，有一支會多帶 `folder`，還有一支的端點是從外部傳進來的。
 *
 * 更重要的是——這 10 份裡只有 MediaUploadField.jsx 檢查了
 * `if (!result.secure_url) throw`。其餘 9 支在「HTTP 200 但回應內容不如預期」
 * 時會把 `undefined` 直接寫進表單欄位／使用者頭像，接著一路存進資料庫，
 * 而且完全不會報錯。把驗證收進這個工具裡，等於一次補上這 9 個潛在缺口。
 *
 * 這裡只負責「把檔案送上去、拿回網址」這件事，不碰任何 UI 狀態
 * （uploading flag、預覽圖、錯誤訊息顯示、寫回哪個表單欄位）——那些本來就
 * 因頁面而異，留在各自的呼叫端。
 *
 * 2026-10-19 修正：`image/upload/f_auto,q_auto` 這個「上傳端點」其實從頭
 * 就是錯的——`f_auto,q_auto` 是套在 res.cloudinary.com 的「取圖網址」上的
 * 轉換參數，不是 api.cloudinary.com 上傳 API 的合法路徑，打上去 Cloudinary
 * 一律回 404（且該 404 回應不帶 CORS header，瀏覽器主控台因此同時看到
 * CORS 錯誤）。凡是沒有明確傳 `transform: false` 的圖片上傳（多數呼叫點）
 * 在正式環境一律會上傳失敗。改為一律打乾淨的 `.../upload`，轉換改成上傳
 * 成功後套在回傳的 `secure_url` 上（取圖網址，Cloudinary 真正支援轉換的
 * 地方）。
 */

const CLOUDINARY_TRANSFORM = 'f_auto,q_auto';
const CLOUDINARY_RESOURCE_TYPES = ['image', 'video'];

/**
 * 稽核 FE1-12：上傳用的是打包進前端的「未簽章 preset」，真正的防線只能在 Cloudinary 後台的 preset
 * 設定（允許格式、檔案大小、固定資料夾、停用覆寫）或改由後端簽章。這裡是前端能做的緩解：
 * 送出前先擋下類型不符或過大的檔案，避免站內任何呼叫點（含註冊頁）誤傳非媒體檔或超大檔案。
 * 擋不住直接拿 preset 打 API 的人，這點要在回報中說明。
 *
 * 上限取 Cloudinary 免費方案單檔上限（圖片 10 MB、影音 100 MB）；各呼叫點自己已有更嚴的限制（多為 5 MB），
 * 這裡只是最後一道總上限，不改變既有呼叫點的行為。
 * Cloudinary 的 video 資源類型同時涵蓋音檔（QuizTrueFalse 的 mp3 就走 video），所以 video 也接受 audio/*。
 */
const MB = 1024 * 1024;
export const CLOUDINARY_MAX_BYTES = { image: 10 * MB, video: 100 * MB };
const ALLOWED_MIME_PREFIXES = { image: ['image/'], video: ['video/', 'audio/'] };
// 部分系統（例如 Windows 少見副檔名）會給空的 file.type，這時才退回用副檔名判斷
const ALLOWED_EXTENSIONS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'bmp'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'flac'],
};

function isAllowedType(file, resourceType) {
  const type = typeof file?.type === 'string' ? file.type.toLowerCase() : '';
  if (type) return ALLOWED_MIME_PREFIXES[resourceType].some((prefix) => type.startsWith(prefix));
  const name = typeof file?.name === 'string' ? file.name.toLowerCase() : '';
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return ALLOWED_EXTENSIONS[resourceType].includes(ext);
}

/** 上傳失敗時丟出的例外；`cause` 保留原始錯誤（網路層例外或 HTTP 狀態）供
 * 呼叫端記 log，但呼叫端顯示給使用者的訊息一律自己決定，不直接用這裡的
 * message（跟後端「不把內部錯誤原文透出給使用者」的既有原則一致）。 */
export class CloudinaryUploadError extends Error {
  constructor(message, { status, cause, code } = {}) {
    super(message);
    this.name = 'CloudinaryUploadError';
    this.status = status;
    // 稽核 FE1-12：送出前就被擋下時的原因（invalid_type／too_large），呼叫端可據此顯示訊息
    this.code = code;
    this.cause = cause;
  }
}

/**
 * @param {File|Blob} file 要上傳的檔案
 * @param {object}   [options]
 * @param {'image'|'video'} [options.resourceType='image'] Cloudinary 的資源類型。
 * @param {boolean}  [options.transform] 是否在回傳的網址上加 `f_auto,q_auto`
 *   自動格式／品質轉換。預設值跟著 resourceType 走（圖片加、影音不加）；
 *   需要純網址不轉換的圖片（例如筆記插圖）明確傳 false。
 * @param {string}   [options.folder] Cloudinary 端的資料夾。
 * @param {AbortSignal} [options.signal] 讓呼叫端可以在元件卸載時中止上傳。
 * @returns {Promise<string>} 上傳後的 secure_url（保證是非空字串）。
 */
export async function uploadToCloudinary(file, options = {}) {
  const {
    resourceType = 'image',
    transform = resourceType === 'image',
    folder,
    signal,
  } = options;

  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    // 環境變數沒設定時，原本的寫法會組出 `.../v1_1/undefined/image/upload`
    // 打過去拿到一個語意不明的 4xx；這裡提前擋下並講清楚原因。
    throw new CloudinaryUploadError('Cloudinary 環境變數未設定（VITE_CLOUDINARY_CLOUD_NAME／VITE_CLOUDINARY_UPLOAD_PRESET）');
  }

  if (!CLOUDINARY_RESOURCE_TYPES.includes(resourceType)) {
    // resourceType 會直接組進上傳網址的路徑（.../${resourceType}/upload），
    // 呼叫端傳錯字串時應該立刻報錯，而不是打出一個看起來像合法路徑、
    // 實際上 Cloudinary 會回 4xx 的網址。
    throw new CloudinaryUploadError(`不支援的 resourceType："${resourceType}"（僅支援 ${CLOUDINARY_RESOURCE_TYPES.join('／')}）`);
  }

  // 稽核 FE1-12：類型與大小在送出前檢查（說明見檔案上方 ALLOWED_MIME_PREFIXES）
  if (!isAllowedType(file, resourceType)) {
    throw new CloudinaryUploadError(`檔案類型不符（${resourceType} 只接受${resourceType === 'image' ? '圖片' : '影片或音檔'}）`, { code: 'invalid_type' });
  }
  if (typeof file?.size === 'number' && file.size > CLOUDINARY_MAX_BYTES[resourceType]) {
    throw new CloudinaryUploadError(`檔案超過 ${CLOUDINARY_MAX_BYTES[resourceType] / MB} MB 上限`, { code: 'too_large' });
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);
  formData.append('cloud_name', cloudName);
  if (folder) formData.append('folder', folder);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', body: formData, signal });
  } catch (err) {
    // AbortError 是呼叫端自己中止的（元件卸載、使用者換檔），不是真的失敗，
    // 原樣往外丟讓呼叫端能用 err.name === 'AbortError' 判斷並靜默忽略。
    if (err?.name === 'AbortError') throw err;
    throw new CloudinaryUploadError('無法連線到 Cloudinary', { cause: err });
  }

  if (!response.ok) {
    throw new CloudinaryUploadError(`Cloudinary 回應 HTTP ${response.status}`, { status: response.status });
  }

  let result;
  try {
    result = await response.json();
  } catch (err) {
    throw new CloudinaryUploadError('Cloudinary 回應不是合法的 JSON', { cause: err });
  }

  if (!result?.secure_url) {
    throw new CloudinaryUploadError('Cloudinary 回應缺少 secure_url');
  }

  // 轉換套在取圖網址上（`/upload/<轉換>/...`），不是上傳端點。
  return transform
    ? result.secure_url.replace('/upload/', `/upload/${CLOUDINARY_TRANSFORM}/`)
    : result.secure_url;
}
