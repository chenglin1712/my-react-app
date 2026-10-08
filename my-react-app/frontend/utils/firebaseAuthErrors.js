// Firebase Auth 錯誤碼 → 給使用者看的中文訊息。
// 登入、註冊、忘記密碼、變更密碼原本各自寫一小段 switch，登入失敗還會把 Firebase 的英文
// error.message 原樣顯示給使用者；統一在這裡對照，沒有對應的錯誤一律顯示呼叫端給的通用訊息，
// 詳細內容只留在 console，不顯示在畫面上。
const MESSAGES = {
  'auth/invalid-credential': '帳號或密碼錯誤，請檢查電子郵件和密碼是否正確',
  'auth/wrong-password': '帳號或密碼錯誤，請檢查電子郵件和密碼是否正確',
  // 登入時不分辨「沒有這個帳號」與「密碼錯誤」，避免被用來探測哪些 Email 已註冊
  'auth/user-not-found': '帳號或密碼錯誤，請檢查電子郵件和密碼是否正確',
  'auth/invalid-email': 'Email 格式不正確',
  'auth/missing-email': '請輸入 Email',
  'auth/missing-password': '請輸入密碼',
  'auth/user-disabled': '這個帳號已被停用，請聯絡管理員',
  'auth/too-many-requests': '嘗試次數過多，請稍後再試',
  'auth/network-request-failed': '網路連線失敗，請檢查網路後再試一次',
  'auth/email-already-in-use': 'Email 已被註冊過',
  'auth/weak-password': '密碼強度不足，請使用至少 6 個字元',
  'auth/operation-not-allowed': '目前不支援這種登入方式',
  'auth/requires-recent-login': '為了帳號安全，請重新登入後再試一次',
  'auth/expired-action-code': '連結已過期，請重新申請',
  'auth/invalid-action-code': '連結無效或已經使用過，請重新申請',
};

export function authErrorMessage(error, fallback = '發生未預期的錯誤，請稍後再試') {
  return MESSAGES[error?.code] ?? fallback;
}
