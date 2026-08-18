import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useNotePages } from './useNotePages';

/** FE-11：分享選取原本存的是陣列索引，而 handleDelete 會從中間刪掉一頁卻
 * 完全沒有調整選取內容。選了某一頁之後刪掉它前面的頁，選取就會指到另一篇
 * 筆記——分享出去的是錯的內容；索引超出範圍時 notes[i] 是 undefined，
 * _note/index.jsx 讀 note.title 會直接丟 TypeError 讓分享中斷。
 *
 * 改成用筆記 id 之後，這裡鎖住三件事：選取跟著筆記本身走、刪除會把該頁移出
 * 選取、全選給的是 id。 */

// TipTap 的 useEditor 在 jsdom 下需要完整的 DOM/ProseMirror 環境，這幾支測試
// 只驗證筆記與選取的狀態邏輯，不碰編輯器本身，用一個可以控制 getHTML()
// 回傳值的假編輯器取代。
const fakeEditor = {
    html: '<p></p>',
    getHTML() { return this.html; },
    commands: { setContent: vi.fn() },
    chain: () => ({ focus: () => ({}) }),
};
vi.mock('@tiptap/react', () => ({ useEditor: () => fakeEditor }));
vi.mock('@tiptap/starter-kit', () => ({ StarterKit: {} }));
vi.mock('@tiptap/extension-text-style', () => ({ TextStyle: {} }));
vi.mock('@tiptap/extension-color', () => ({ Color: {} }));
vi.mock('@tiptap/extension-image', () => ({
    Image: { configure: () => ({}) },
}));
vi.mock('../fontSizeExtension', () => ({ default: {} }));

const UID = 'user-1';
const LOCAL_KEY = `userNotes_${UID}`;

function seedNotes(notes) {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(notes));
}

describe('useNotePages 的分享選取（FE-11）', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    test('刪除前面的頁次後，選取仍然指向原本那一篇筆記', () => {
        seedNotes([
            { id: 'a', title: '第一篇', content: '<p>A</p>' },
            { id: 'b', title: '第二篇', content: '<p>B</p>' },
            { id: 'c', title: '第三篇', content: '<p>C</p>' },
        ]);

        const { result } = renderHook(() => useNotePages(UID));

        // 選取第三篇
        act(() => { result.current.handleToggleSelect('c'); });
        expect(result.current.selectedPageIds).toEqual(['c']);

        // 停在第一頁並刪掉它——修正前選取的索引 2 會變成指向不存在的位置
        act(() => { result.current.handleDelete(); });

        expect(result.current.notes.map((n) => n.id)).toEqual(['b', 'c']);
        // 選取仍然是「第三篇」這篇筆記本身
        expect(result.current.selectedPageIds).toEqual(['c']);
    });

    test('刪除的正好是被選取的那一頁時，會一併移出選取', () => {
        seedNotes([
            { id: 'a', title: '第一篇', content: '<p>A</p>' },
            { id: 'b', title: '第二篇', content: '<p>B</p>' },
        ]);

        const { result } = renderHook(() => useNotePages(UID));

        act(() => { result.current.handleToggleSelect('a'); });
        expect(result.current.selectedPageIds).toEqual(['a']);

        act(() => { result.current.handleDelete(); });

        expect(result.current.selectedPageIds).toEqual([]);
    });

    test('選取的順序沿用勾選的先後，讓分享預覽來源維持可預期', () => {
        seedNotes([
            { id: 'a', title: '第一篇', content: '<p>A</p>' },
            { id: 'b', title: '第二篇', content: '<p>B</p>' },
        ]);

        const { result } = renderHook(() => useNotePages(UID));

        act(() => { result.current.handleToggleSelect('b'); });
        act(() => { result.current.handleToggleSelect('a'); });

        expect(result.current.selectedPageIds).toEqual(['b', 'a']);
    });

    test('全選給的是筆記 id 而不是索引', () => {
        seedNotes([
            { id: 'a', title: '第一篇', content: '<p>A</p>' },
            { id: 'b', title: '第二篇', content: '<p>B</p>' },
        ]);

        const { result } = renderHook(() => useNotePages(UID));

        act(() => { result.current.handleSelectAll(); });

        expect(result.current.selectedPageIds).toEqual(['a', 'b']);
    });

    test('舊版沒有 id 的 localStorage 資料，載入時會補上並寫回', () => {
        seedNotes([
            { title: '舊資料一', content: '<p>A</p>' },
            { title: '舊資料二', content: '<p>B</p>' },
        ]);

        const { result } = renderHook(() => useNotePages(UID));

        const ids = result.current.notes.map((n) => n.id);
        expect(ids.every((id) => id != null)).toBe(true);
        expect(new Set(ids).size).toBe(2);

        // 補上的 id 要寫回 localStorage，重新整理後才不會又變一組新的
        const persisted = JSON.parse(localStorage.getItem(LOCAL_KEY));
        expect(persisted.map((n) => n.id)).toEqual(ids);
    });
});

/** 淺拷貝後直接改物件內容（等於改動 React state）原本讓「先存檔、緊接著讀
 * notes」剛好拿得到最新內容——但那是靠改壞東西換來的。改成正確的不可變更新
 * 之後，任何「呼叫完 updateCurrentContent 又從舊閉包重組陣列」的地方都會安靜
 * 地把剛存的內容丟掉，所以兩件事必須一起修。這裡鎖住修好之後的行為。 */
describe('useNotePages 的存檔與不可變更新', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        fakeEditor.html = '<p></p>';
        fakeEditor.commands.setContent.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
    });

    test('handleSave 回傳寫回編輯器內容之後的最新陣列', () => {
        seedNotes([{ id: 'a', title: '第一篇', content: '<p>舊</p>' }]);
        const { result } = renderHook(() => useNotePages(UID));

        fakeEditor.html = '<p>新內容</p>';

        let saved;
        act(() => { saved = result.current.handleSave(); });

        // 呼叫端要能直接從回傳值拿到最新內容，不必等 setNotes 生效
        expect(saved[0].content).toBe('<p>新內容</p>');
    });

    test('新增頁面時不會把剛寫回的當前頁內容蓋掉', () => {
        seedNotes([{ id: 'a', title: '第一篇', content: '<p>舊</p>' }]);
        const { result } = renderHook(() => useNotePages(UID));

        fakeEditor.html = '<p>編輯到一半的內容</p>';

        // handleAdd 內部會先 updateCurrentContent() 再組新陣列——如果它從舊的
        // notes 閉包重組，第一頁就會退回 '<p>舊</p>'。
        act(() => { result.current.handleAdd(); });

        expect(result.current.notes).toHaveLength(2);
        expect(result.current.notes[0].content).toBe('<p>編輯到一半的內容</p>');
    });

    test('存檔不會就地改動原本的筆記物件（不可變更新）', () => {
        seedNotes([{ id: 'a', title: '第一篇', content: '<p>舊</p>' }]);
        const { result } = renderHook(() => useNotePages(UID));

        const before = result.current.notes;
        const beforeNote = before[0];

        fakeEditor.html = '<p>新</p>';
        act(() => { result.current.handleSave(); });

        // 舊的陣列與舊的物件都必須維持原狀
        expect(beforeNote.content).toBe('<p>舊</p>');
        expect(result.current.notes).not.toBe(before);
        expect(result.current.notes[0]).not.toBe(beforeNote);
        expect(result.current.notes[0].content).toBe('<p>新</p>');
    });

    test('改標題不會就地改動原本的筆記物件，且不會重新載入編輯器內容', () => {
        seedNotes([{ id: 'a', title: '舊標題', content: '<p>A</p>' }]);
        const { result } = renderHook(() => useNotePages(UID));

        const beforeNote = result.current.notes[0];
        fakeEditor.commands.setContent.mockClear();

        act(() => {
            result.current.handleTitleChange({ target: { value: '新標題' } });
        });

        expect(beforeNote.title).toBe('舊標題');
        expect(result.current.notes[0].title).toBe('新標題');
        // 換頁同步的 effect 依賴 id，改標題不該觸發 setContent
        expect(fakeEditor.commands.setContent).not.toHaveBeenCalled();
    });

    test('存檔後 localStorage 也是最新內容', () => {
        seedNotes([{ id: 'a', title: '第一篇', content: '<p>舊</p>' }]);
        const { result } = renderHook(() => useNotePages(UID));

        fakeEditor.html = '<p>新</p>';
        act(() => { result.current.handleSave(); });

        const persisted = JSON.parse(localStorage.getItem(LOCAL_KEY));
        expect(persisted[0].content).toBe('<p>新</p>');
    });
});
