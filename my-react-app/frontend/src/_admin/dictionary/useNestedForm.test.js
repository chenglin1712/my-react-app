import { describe, test, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useNestedForm, withKeys, stripKeys, nodeAt,
} from './useNestedForm';

const baseTree = () => ({
  id: 'word-1',
  name: 'abas',
  source_ids: [1, 2],
  explanations: [
    { id: 10, chinese_explanation: '解釋一', category_ids: [1], sentences: [] },
    { id: 11, chinese_explanation: '解釋二', category_ids: [], sentences: [] },
  ],
});

describe('withKeys / stripKeys', () => {
  test('withKeys 幫每個物件陣列元素掛上不重複的 _key，純量陣列不受影響', () => {
    const tree = withKeys(baseTree());
    expect(tree._key).toBeTruthy();
    expect(tree.explanations[0]._key).toBeTruthy();
    expect(tree.explanations[1]._key).toBeTruthy();
    expect(tree.explanations[0]._key).not.toBe(tree.explanations[1]._key);
    expect(tree.source_ids).toEqual([1, 2]); // 純量陣列沒有被加上 _key
  });

  test('stripKeys 完全移除 _key，且是 withKeys 的反向操作', () => {
    const tree = withKeys(baseTree());
    const stripped = stripKeys(tree);
    expect(stripped).toEqual(baseTree());
    expect(JSON.stringify(stripped)).not.toContain('_key');
  });

  test('withKeys 對已經有 _key 的節點保留原本的 _key（不會每次渲染都換新）', () => {
    const once = withKeys(baseTree());
    const twice = withKeys(once);
    expect(twice._key).toBe(once._key);
    expect(twice.explanations[0]._key).toBe(once.explanations[0]._key);
  });
});

describe('useNestedForm', () => {
  test('update 只改動指定節點的欄位，其餘節點維持原本的物件參照（結構共享）', () => {
    const { result } = renderHook(() => useNestedForm(baseTree()));
    const untouchedRef = result.current.tree.explanations[1];
    const targetKey = result.current.tree.explanations[0]._key;

    act(() => {
      result.current.update(
        [{ field: 'explanations', key: targetKey }],
        { chinese_explanation: '解釋一（已修改）' },
      );
    });

    expect(result.current.tree.explanations[0].chinese_explanation).toBe('解釋一（已修改）');
    expect(result.current.tree.explanations[1]).toBe(untouchedRef); // 沒被動到的兄弟節點物件參照不變
  });

  test('addChild 附加新節點並自動掛上 _key', () => {
    const { result } = renderHook(() => useNestedForm(baseTree()));

    act(() => {
      result.current.addChild([], 'explanations', () => ({
        id: null, chinese_explanation: '解釋三', category_ids: [], sentences: [],
      }));
    });

    expect(result.current.tree.explanations).toHaveLength(3);
    const newNode = result.current.tree.explanations[2];
    expect(newNode._key).toBeTruthy();
    expect(newNode.chinese_explanation).toBe('解釋三');
  });

  test('removeChild 之後 toPayload 陣列位置正確覆寫、不含 _key，且刪除中間節點不影響其餘節點的內容',
    () => {
      const { result } = renderHook(() => useNestedForm({
        id: 'exp-1', sentences: [
          { id: 1, original_sentence: '句子一' },
          { id: 2, original_sentence: '句子二' },
          { id: 3, original_sentence: '句子三' },
        ],
      }));

      const keys = result.current.tree.sentences.map((s) => s._key);
      const [key1, key2, key3] = keys;

      // 這是 QuizBank.jsx blanks 物件（用字串 key 兼職順序/身分/內容標記）
      // 已確認過的脆弱點的回歸測試：刪除中間一筆之後再新增一筆，舊實作用
      // Object.keys(...).length + 1 算下一個編號會產生 key 衝突或跳號、
      // 且可能讓內容跑到錯的節點上。
      act(() => {
        result.current.removeChild([], 'sentences', key2); // 刪除中間（句子二）
      });
      act(() => {
        result.current.addChild([], 'sentences', () => ({ id: null, original_sentence: '句子四' }));
      });

      const finalKeys = result.current.tree.sentences.map((s) => s._key);
      // 剩下的三個 key 互不相同（key1／key3／新節點的 key）
      expect(new Set(finalKeys).size).toBe(3);
      expect(finalKeys).toContain(key1);
      expect(finalKeys).toContain(key3);
      expect(finalKeys).not.toContain(key2);

      // 內容沒有互相污染：句子一、句子三的內容還是原本的內容，不是被刪除的
      // 句子二的內容，順序也符合畫面顯示順序（一、三、四）。
      const contents = result.current.tree.sentences.map((s) => s.original_sentence);
      expect(contents).toEqual(['句子一', '句子三', '句子四']);

      const payload = result.current.toPayload();
      expect(JSON.stringify(payload)).not.toContain('_key');
      expect(JSON.stringify(payload)).not.toContain('sort_order');
      expect(payload.sentences.map((s) => s.original_sentence)).toEqual(['句子一', '句子三', '句子四']);
    });

  test('moveChild 依 delta 調整陣列順序，超出邊界時不做任何事', () => {
    const { result } = renderHook(() => useNestedForm({
      id: 'exp-1', sentences: [
        { id: 1, original_sentence: 'A' },
        { id: 2, original_sentence: 'B' },
        { id: 3, original_sentence: 'C' },
      ],
    }));
    const keyA = result.current.tree.sentences[0]._key;

    act(() => {
      result.current.moveChild([], 'sentences', keyA, 1); // A 往後移一格：B, A, C
    });
    expect(result.current.tree.sentences.map((s) => s.original_sentence)).toEqual(['B', 'A', 'C']);

    act(() => {
      // 已經在最前面的 B 再往前移一格，超出邊界應該維持原狀
      const keyB = result.current.tree.sentences[0]._key;
      result.current.moveChild([], 'sentences', keyB, -1);
    });
    expect(result.current.tree.sentences.map((s) => s.original_sentence)).toEqual(['B', 'A', 'C']);
  });

  test('深層路徑（詞條→解釋→例句→標註）可以正確定位並更新最深層節點', () => {
    const deepTree = {
      id: 'word-1',
      explanations: [{
        id: 10,
        sentences: [{
          id: 20,
          anaphoras: [{
            id: 30, is_highlight: false,
            items: [{ id: 40, name: 'na', word_id: null }],
          }],
        }],
      }],
    };
    const { result } = renderHook(() => useNestedForm(deepTree));

    const expKey = result.current.tree.explanations[0]._key;
    const sentKey = result.current.tree.explanations[0].sentences[0]._key;
    const anaKey = result.current.tree.explanations[0].sentences[0].anaphoras[0]._key;

    act(() => {
      result.current.addChild(
        [
          { field: 'explanations', key: expKey },
          { field: 'sentences', key: sentKey },
          { field: 'anaphoras', key: anaKey },
        ],
        'items',
        () => ({ id: null, name: '。', word_id: null }),
      );
    });

    const items = result.current.tree.explanations[0].sentences[0].anaphoras[0].items;
    expect(items).toHaveLength(2);
    expect(items[1].name).toBe('。');

    const node = nodeAt(result.current.tree, [
      { field: 'explanations', key: expKey },
      { field: 'sentences', key: sentKey },
      { field: 'anaphoras', key: anaKey },
    ]);
    expect(node.id).toBe(30);
  });

  test('reset 用新的樹取代目前狀態並重新掛 key', () => {
    const { result } = renderHook(() => useNestedForm(baseTree()));
    act(() => {
      result.current.reset({ id: 'word-2', name: 'huzil', explanations: [] });
    });
    expect(result.current.tree.name).toBe('huzil');
    expect(result.current.tree._key).toBeTruthy();
  });
});
