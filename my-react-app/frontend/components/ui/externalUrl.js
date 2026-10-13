// 只有 http(s) 網址算外部連結；空字串、相對路徑、javascript: 等一律不算
export const isExternalUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url.trim());
