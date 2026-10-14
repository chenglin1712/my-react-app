import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import NotePage from './index';
import { shareNote } from '../userServives/noteService';
import { uploadToCloudinary } from '@utils/uploadToCloudinary';

// 站內確認視窗（原本是瀏覽器原生 window.confirm）：測試直接替換成可控制回傳值的 mock
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

/** 回歸測試：圖片原本是選取後轉成 Base64 直接塞進編輯器內容，這段內容會
 * 原封不動存進 localStorage、分享時又整包寫進 Firestore 的 pages 欄位，
 * 容易讓內容超過 Firestore 單一文件 1 MiB 的上限（buildPreview() 的註解記錄
 * 了同一個根因曾經讓「只要分享的筆記裡有圖片就一定失敗」）。改成選取後
 * 立刻上傳 Cloudinary、編輯器只插入真正的圖片網址。 */

const fakeEditor = {
  html: '<p></p>',
  getHTML() { return fakeEditor.html; },
  commands: { setContent: vi.fn() },
};
fakeEditor.chain = () => ({
  focus: () => ({
    toggleBold: () => ({ run: () => {} }),
    toggleItalic: () => ({ run: () => {} }),
    setFontSize: () => ({ run: () => {} }),
    setColor: () => ({ run: () => {} }),
    setImage: ({ src }) => ({ run: () => { fakeEditor.html = `<img src="${src}">`; } }),
  }),
});

vi.mock('@tiptap/react', () => ({ useEditor: () => fakeEditor, EditorContent: () => null }));
vi.mock('@tiptap/starter-kit', () => ({ StarterKit: {} }));
vi.mock('@tiptap/extension-text-style', () => ({ TextStyle: {} }));
vi.mock('@tiptap/extension-color', () => ({ Color: {} }));
vi.mock('@tiptap/extension-image', () => ({ Image: { configure: () => ({}) } }));
vi.mock('./fontSizeExtension', () => ({ default: {} }));

vi.mock('../userServives/noteService', () => ({ shareNote: vi.fn() }));
vi.mock('@utils/uploadToCloudinary', () => ({ uploadToCloudinary: vi.fn() }));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: { uid: 'user-1', firestoreData: { name: '測試使用者' } } }),
}));

const LOCAL_KEY = 'userNotes_user-1';

function renderPage() {
  return render(<MemoryRouter><NotePage /></MemoryRouter>);
}

describe('NotePage（_note/index.jsx）', () => {
  beforeEach(() => {
    localStorage.clear();
    fakeEditor.html = '<p></p>';
    shareNote.mockReset();
    uploadToCloudinary.mockReset();
  });

  test('回歸測試：選擇圖片後立刻上傳 Cloudinary，並把真正的網址插入編輯器內容，不再把整張圖轉成 Base64', async () => {
    uploadToCloudinary.mockResolvedValue('https://res.cloudinary.com/demo/image/upload/note.jpg');
    const user = userEvent.setup();
    renderPage();

    const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);

    await waitFor(() => expect(uploadToCloudinary).toHaveBeenCalledWith(
      file, { folder: 'tayal_note', transform: false }
    ));
    expect(fakeEditor.html).toBe('<img src="https://res.cloudinary.com/demo/image/upload/note.jpg">');
  });

  test('圖片上傳失敗時顯示錯誤訊息，不會把失敗的結果插入編輯器', async () => {
    uploadToCloudinary.mockRejectedValue(new Error('network fail'));
    const user = userEvent.setup();
    renderPage();

    const file = new File(['fake-image-bytes'], 'photo.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);

    expect(await screen.findByText('圖片上傳失敗，請稍後再試。')).toBeInTheDocument();
    expect(fakeEditor.html).toBe('<p></p>');
  });

  test('回歸測試：快速連點兩次分享按鈕，只會真的呼叫一次 shareNote', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([{ id: 'a', title: '我的標題', content: '<p>A</p>' }]));
    let shareCallCount = 0;
    shareNote.mockImplementation(() => {
      shareCallCount += 1;
      return new Promise(() => {}); // 故意不 resolve，模擬還在寫入中
    });

    renderPage();

    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);

    const shareButton = await screen.findByRole('button', { name: '分享' });
    fireEvent.click(shareButton);
    fireEvent.click(shareButton);

    await waitFor(() => expect(shareCallCount).toBe(1));
  });

  test('D-4：選取的頁面合計超過約 900 KB 時，分享被擋下、不寫入 Firestore，並指出最大的一頁', async () => {
    const big = (id, title, kb) => ({ id, title, content: `<p>${'x'.repeat(kb * 1024)}</p>` });
    localStorage.setItem(LOCAL_KEY, JSON.stringify([
      big('a', '小的一頁', 100), big('b', '最大的一頁', 500), big('c', '中的一頁', 400),
    ]));

    renderPage();
    const boxes = await screen.findAllByRole('checkbox');
    boxes.forEach((box) => fireEvent.click(box));
    fireEvent.click(await screen.findByRole('button', { name: '分享' }));

    expect(await screen.findByText(/合計約 \d+ KB，超過分享上限約 900 KB/)).toBeInTheDocument();
    expect(screen.getByText(/資料量最大的一頁是「最大的一頁」/)).toBeInTheDocument();
    expect(shareNote).not.toHaveBeenCalled();
  });

  test('D-4：只選一頁、而且那一頁本身就太大：不建議「少選幾頁」，改說明該頁過大', async () => {
    // 分享前會先把編輯器目前的內容存回當前頁，所以假編輯器也要放同一份內容
    const huge = `<p>${'字'.repeat(310 * 1024)}</p>`; // 中文每字 3 位元組，約 930 KB
    localStorage.setItem(LOCAL_KEY, JSON.stringify([{ id: 'a', title: '巨大的一頁', content: huge }]));
    fakeEditor.html = huge;

    renderPage();
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: '分享' }));

    expect(await screen.findByText(/這一頁的資料量約 \d+ KB，超過分享上限約 900 KB/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText(/少選幾頁/)).not.toBeInTheDocument();
    expect(shareNote).not.toHaveBeenCalled();
  }, 20000);

  test('D-4：合計在上限內照常分享', async () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([
      { id: 'a', title: '第一頁', content: `<p>${'x'.repeat(200 * 1024)}</p>` },
    ]));
    shareNote.mockResolvedValue({ id: 'shared-1' });
    confirmMock.mockResolvedValue(false);

    renderPage();
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: '分享' }));

    await waitFor(() => expect(shareNote).toHaveBeenCalledTimes(1));
  });
});
