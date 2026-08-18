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
 */

const CLOUDINARY_TRANSFORM = 'f_auto,q_auto';

/** 上傳失敗時丟出的例外；`cause` 保留原始錯誤（網路層例外或 HTTP 狀態）供
 * 呼叫端記 log，但呼叫端顯示給使用者的訊息一律自己決定，不直接用這裡的
 * message（跟後端「不把內部錯誤原文透出給使用者」的既有原則一致）。 */
export class CloudinaryUploadError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'CloudinaryUploadError';
    this.status = status;
    this.cause = cause;
  }
}

/**
 * @param {File|Blob} file 要上傳的檔案
 * @param {object}   [options]
 * @param {'image'|'video'} [options.resourceType='image'] Cloudinary 的資源類型。
 * @param {boolean}  [options.transform] 是否加上 `f_auto,q_auto` 自動格式／品質
 *   轉換。預設值刻意跟著 resourceType 走（圖片加、影音不加），因為這正是既有
 *   10 個呼叫點的實際行為；需要純上傳不轉換的圖片（例如筆記插圖）明確傳 false。
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

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);
  formData.append('cloud_name', cloudName);
  if (folder) formData.append('folder', folder);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`
    + (transform ? `/${CLOUDINARY_TRANSFORM}` : '');

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

  return result.secure_url;
}

export default uploadToCloudinary;
