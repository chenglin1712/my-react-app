// 後端 AllWordsRequest.favorite_names 的筆數上限（schemas.py）
export const MAX_NAMES_PER_REQUEST = 500;

/** 所有收藏分類裡的詞名，去重、保留第一次出現的順序。 */
export function collectFavoriteNames(favorites) {
  const seen = new Set();
  for (const category of Array.isArray(favorites) ? favorites : []) {
    const content = Array.isArray(category?.content) ? category.content : [];
    for (const name of content) {
      if (typeof name === 'string' && name) seen.add(name);
    }
  }
  return [...seen];
}

/** 切成不超過後端上限的小批；空陣列回傳空陣列（不需要發任何請求）。 */
export function chunkNames(names, size = MAX_NAMES_PER_REQUEST) {
  const chunks = [];
  for (let i = 0; i < names.length; i += size) chunks.push(names.slice(i, i + size));
  return chunks;
}
