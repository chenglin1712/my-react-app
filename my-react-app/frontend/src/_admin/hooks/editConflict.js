/**
 * 樂觀鎖衝突（稽核 FE7b-08）：後端對帶了 base_updated_at／base_version 的儲存請求，
 * 發現資料在載入之後被別人改過，會回 409 且 code=edit_conflict。
 */
export const isEditConflict = (err) => err?.status === 409 && err?.data?.code === 'edit_conflict';
