/**
 * 辭典詞條編輯器的巢狀表單狀態管理——8 層巢狀（詞條→解釋→例句→
 * 音檔/圖片/標註）需要一個比全專案目前最深前例更穩固的資料結構。
 *
 * 全專案目前最深的巢狀編輯前例是 QuizBank.jsx 的克漏字空格編輯器：
 * `form.blanks` 是一個用字串 key（"blank1"／"blank2"…）當索引的物件，
 * 這個字串同時身兼三種角色——React key、內容本身的標記（passage_foreign
 * 裡的 {blank1}）、陣列順序（addBlank 用 Object.keys(form.blanks).length+1
 * 算下一個編號）。三種角色疊在同一個字串上，導致「刪除中間一個空格、
 * 再新增一個」會產生 key 衝突或跳號——三個角色只要有一個更新就會波及
 * 其他兩個。
 *
 * 這裡把三件事徹底分開：
 *   - `_key`：純前端識別用，元件掛載時就決定、永遠不變、永遠不會被送到
 *     後端（見 stripKeys）。React 的 list key 用它，不用陣列 index。
 *   - `id`：伺服器身分，新節點是 null，存檔後由後端指派。
 *   - 陣列位置：唯一決定送出時的順序（後端一律用陣列位置覆寫
 *     sort_order，不讀任何 client 端送來的順序欄位——後端這一側的設計見
 *     backend/adminapi/dictionary_write.py 的 _reconcile_children）。
 *
 * 因為順序不再靠字串 key 維護，刪除中間節點只是單純的 filter，不需要
 * 任何重新編號的步驟，也就不會製造 key 衝突。
 *
 * `path` 是一串 `{ field, key }`，從樹根一路指到任意深度的節點，例如
 * 編輯第 2 個解釋底下第 1 個例句的標註：
 *   [{ field: 'explanations', key: 'k-a1' }, { field: 'sentences', key: 'k-b7' },
 *    { field: 'anaphoras', key: 'k-c2' }]
 * `update`/`addChild`/`removeChild`/`moveChild` 四個函式就能操作任意深度，
 * 不需要像 QuizBank.jsx 那樣每多一層巢狀就多寫一組 updateX/addX/removeX。
 */
import { useCallback, useState } from 'react';

let fallbackKeyCounter = 0;

/** crypto.randomUUID 在部分測試環境（例如舊版 jsdom）可能不存在，退回一個
 * 單調遞增計數器——測試環境不需要真正的全域唯一性，只需要「同一次渲染裡
 * 不會撞號」。 */
function generateKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackKeyCounter += 1;
  return `local-${fallbackKeyCounter}`;
}

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

/** 遞迴幫樹裡每個「物件陣列」的元素掛上 _key。純量陣列（例如
 * category_ids: [1, 2, 3]）裡的元素不是物件，維持原樣不處理——不需要
 * 白名單列出哪些欄位是巢狀節點、哪些是純量陣列，靠元素本身的型別判斷。 */
export function withKeys(node) {
  if (Array.isArray(node)) {
    return node.map((item) => (isPlainObject(item) ? withKeys(item) : item));
  }
  if (isPlainObject(node)) {
    const next = { ...node, _key: node._key || generateKey() };
    Object.keys(next).forEach((field) => {
      if (field === '_key') return;
      if (Array.isArray(next[field])) {
        next[field] = withKeys(next[field]);
      }
    });
    return next;
  }
  return node;
}

/** withKeys 的反向操作，存檔前呼叫——遞迴移除全部 _key，不送到後端。
 * sort_order 本來就不會出現在從後端讀回的資料裡（見 dictionary_write.py
 * 的 get_word_tree），前端狀態裡也從未存過，這裡不需要額外處理。 */
export function stripKeys(node) {
  if (Array.isArray(node)) {
    return node.map((item) => (isPlainObject(item) ? stripKeys(item) : item));
  }
  if (isPlainObject(node)) {
    const { _key, ...rest } = node;
    Object.keys(rest).forEach((field) => {
      if (Array.isArray(rest[field])) {
        rest[field] = stripKeys(rest[field]);
      }
    });
    return rest;
  }
  return node;
}

/** 沿著 path 走到底，回傳該節點目前的值（唯讀，給元件渲染用）。 */
export function nodeAt(tree, path) {
  return path.reduce((node, { field, key }) => {
    if (!node) return node;
    const list = node[field] || [];
    return list.find((child) => child._key === key);
  }, tree);
}

/** 沿著 path 走到底，用 updater(node) 的回傳值替換那個節點，只複製
 * path 沿途經過的節點（結構共享）——沒被動到的兄弟子樹保留原本的物件
 * 參照，讓外層用 React.memo 包住深層節點時，打字打在其中一個欄位不會
 * 讓整棵樹重新渲染。 */
function updateAt(tree, path, updater) {
  if (path.length === 0) {
    return updater(tree);
  }
  const [{ field, key }, ...rest] = path;
  const list = tree[field] || [];
  return {
    ...tree,
    [field]: list.map((child) => (
      child._key === key ? updateAt(child, rest, updater) : child
    )),
  };
}

export function useNestedForm(initialTree) {
  const [tree, setTree] = useState(() => withKeys(initialTree));

  const reset = useCallback((nextTree) => {
    setTree(withKeys(nextTree));
  }, []);

  const update = useCallback((path, patch) => {
    setTree((current) => updateAt(current, path, (node) => ({ ...node, ...patch })));
  }, []);

  /** factory() 回傳新節點的資料（不含 _key，這裡會自動掛上）。 */
  const addChild = useCallback((path, field, factory) => {
    setTree((current) => updateAt(current, path, (node) => ({
      ...node,
      [field]: [...(node[field] || []), withKeys(factory())],
    })));
  }, []);

  const removeChild = useCallback((path, field, key) => {
    setTree((current) => updateAt(current, path, (node) => ({
      ...node,
      [field]: (node[field] || []).filter((child) => child._key !== key),
    })));
  }, []);

  const moveChild = useCallback((path, field, key, delta) => {
    setTree((current) => updateAt(current, path, (node) => {
      const list = node[field] || [];
      const index = list.findIndex((child) => child._key === key);
      if (index < 0) return node;
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= list.length) return node;

      const nextList = list.slice();
      const [item] = nextList.splice(index, 1);
      nextList.splice(nextIndex, 0, item);
      return { ...node, [field]: nextList };
    }));
  }, []);

  const toPayload = useCallback(() => stripKeys(tree), [tree]);

  return {
    tree, reset, update, addChild, removeChild, moveChild, toPayload,
  };
}
