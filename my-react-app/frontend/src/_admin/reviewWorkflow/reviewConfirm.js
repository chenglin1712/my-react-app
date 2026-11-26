/**
 * 送審流程中「會立刻改變前台可見內容」的動作，執行前要先說明影響並讓使用者確認（稽核 FE7b-02）。
 *
 * 核准、下架、重新發布都是一鍵就生效，而且「下架」原本是已發布列上最顯眼的主要按鈕，
 * 很容易誤點。撤回、送審、退件不影響前台，不需要這一道確認。
 *
 * @param {string} actionKey REVIEW_ACTION_META 的 key
 * @param {string} [itemLabel] 要顯示在訊息裡的內容名稱（選填）
 * @returns {{title: string, message: string, confirmLabel: string}|null} 不需要確認時回傳 null
 */
export function getTransitionConfirm(actionKey, itemLabel = '') {
    const target = itemLabel ? `「${String(itemLabel).slice(0, 40)}」` : '這筆內容';
    switch (actionKey) {
        case 'approve':
            return {
                title: '核准並發布',
                message: `確定要核准${target}嗎？核准後會立即發布，前台使用者馬上看得到。`,
                confirmLabel: '核准並發布',
            };
        case 'approveRevision':
            return {
                title: '核准修改',
                message: `確定要核准${target}的修改嗎？核准後新內容會立即取代目前已發布的版本。`,
                confirmLabel: '核准修改',
            };
        case 'unpublish':
            return {
                title: '下架',
                message: `確定要下架${target}嗎？下架後會立即從前台移除。`,
                confirmLabel: '下架',
            };
        case 'republish':
            return {
                title: '重新發布',
                message: `確定要重新發布${target}嗎？發布後會立即出現在前台。`,
                confirmLabel: '重新發布',
            };
        default:
            return null;
    }
}
