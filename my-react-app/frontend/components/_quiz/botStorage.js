// AI 助手對話的本機保存（路線圖 #32）。
// 隱私設計：只存在這台裝置的 localStorage，不上傳；以使用者 uid 分開（共用電腦換人登入看不到上一位的），
// 保留 7 天，每次載入時過期就刪。只存可以重新顯示的內容：圖片只存「曾附圖」的標記（預覽網址重新整理後就失效），
// 錯誤訊息與中斷的回覆不存。使用者按「新對話」會刪除。localStorage 不可用（私密視窗、容量滿）時靜默略過，不影響聊天。

export const STORAGE_PREFIX = 'yuanyu.bot.conversation.v1:';
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SAVED_MESSAGES = 40;

const keyFor = (uid) => `${STORAGE_PREFIX}${uid}`;

const storage = () => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

// 只留下重新顯示需要的欄位，並丟掉不該保存的訊息
export function sanitizeMessages(messages) {
    const kept = messages
        .filter((m) => m && !m.isError && !m.interrupted && !m.streaming && typeof m.text === 'string')
        .slice(-MAX_SAVED_MESSAGES)
        .map((m) => {
            const { imageUrl, ...rest } = m;
            return imageUrl ? { ...rest, hadImage: true } : rest;
        });
    // 結尾沒有得到回覆的提問（請求被停止、失敗、中斷）不存：還原後會變成一個沒有答案、也沒有重試鈕的孤兒問題
    while (kept.length > 0 && kept[kept.length - 1].role === 'user') kept.pop();
    return kept;
}

export function hasConversation(messages) {
    return messages.some((m) => m.role === 'user');
}

export function saveConversation(uid, { tribe, messages }, now = Date.now()) {
    const store = storage();
    if (!store || !uid) return;
    try {
        if (!hasConversation(sanitizeMessages(messages))) {
            store.removeItem(keyFor(uid));
            return;
        }
        store.setItem(keyFor(uid), JSON.stringify({ savedAt: now, tribe, messages: sanitizeMessages(messages) }));
    } catch {
        // 容量滿或被封鎖：保存只是方便，失敗就算了
    }
}

// 清掉所有已過期的保存（含其他帳號的）：換人登入後，上一位的過期資料不會一直留在共用裝置上
export function purgeExpired(now = Date.now()) {
    const store = storage();
    if (!store) return;
    try {
        for (let i = store.length - 1; i >= 0; i -= 1) {
            const key = store.key(i);
            if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
            let savedAt = 0;
            try { savedAt = JSON.parse(store.getItem(key))?.savedAt; } catch { /* 壞資料一併清掉 */ }
            if (typeof savedAt !== 'number' || now - savedAt > RETENTION_MS) store.removeItem(key);
        }
    } catch {
        // 同上
    }
}

export function loadConversation(uid, now = Date.now()) {
    const store = storage();
    if (!store || !uid) return null;
    purgeExpired(now);
    try {
        const raw = store.getItem(keyFor(uid));
        if (!raw) return null;
        const data = JSON.parse(raw);
        const valid = data && typeof data.savedAt === 'number' && Array.isArray(data.messages)
            && typeof data.tribe === 'string' && data.messages.length > 0;
        if (!valid || now - data.savedAt > RETENTION_MS) {
            store.removeItem(keyFor(uid));
            return null;
        }
        const messages = sanitizeMessages(data.messages);
        return messages.length > 0 ? { tribe: data.tribe, messages } : null;
    } catch {
        try { store.removeItem(keyFor(uid)); } catch { /* 同上 */ }
        return null;
    }
}

export function clearConversation(uid) {
    const store = storage();
    if (!store || !uid) return;
    try {
        store.removeItem(keyFor(uid));
    } catch {
        // 同上
    }
}

// 目前登入者的 uid。動態載入 firebase：沒有登入或載入失敗就回傳 null（這時不保存、不還原）。
export async function resolveUid() {
    try {
        const { auth } = await import('../../../firebase');
        return auth?.currentUser?.uid || null;
    } catch {
        return null;
    }
}

// 持續監聽登入者：登出或換帳號時回呼新的 uid（登出為 null），回傳取消監聽的函式。
// 無法監聽（沒有 firebase、測試環境）就退回只讀一次目前的 uid。
export function watchUid(onChange) {
    let stopped = false;
    let unsubscribe = () => {};
    (async () => {
        try {
            const [{ auth }, { onAuthStateChanged }] = await Promise.all([import('../../../firebase'), import('firebase/auth')]);
            if (stopped) return;
            unsubscribe = onAuthStateChanged(auth, (user) => { if (!stopped) onChange(user?.uid || null); });
        } catch {
            const uid = await resolveUid();
            if (!stopped) onChange(uid);
        }
    })();
    return () => { stopped = true; unsubscribe(); };
}
