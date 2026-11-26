import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CameraWizard from './index';
import { prepareImageForUpload, ImageUploadError } from './imageUpload';

// 精靈容器本身只負責 step 切換與圖片驗證，實際辨識/查詢邏輯在 label.jsx／result.jsx
// 各自的測試（label.test.jsx／result.test.jsx）裡驗證，這裡把兩步都換成簡單的樁元件，
// 只驗證 index.jsx 自己的職責：step 切換、image/file 傳遞、5MB 大小驗證。
// jsdom 沒有 canvas／createImageBitmap：縮圖與重新編碼的真實邏輯在 imageUpload.test.js 驗證，
// 這裡用替身（FE3-11）：預設原樣放行，個別測試用 prepareImageForUpload.mockRejectedValueOnce 模擬失敗。
vi.mock('./imageUpload', async (importOriginal) => ({
  ...(await importOriginal()),
  prepareImageForUpload: vi.fn(async (file) => file),
}));
vi.mock('./label', () => ({
  default: ({ onConfirm, onBack }) => (
    <div>
      <span>label-step</span>
      <button onClick={() => onConfirm(['balay'])}>confirm-label</button>
      <button onClick={onBack}>back-from-label</button>
    </div>
  ),
}));
vi.mock('./result', () => ({
  default: ({ selectedWords, tribe, onBack, onRestart }) => (
    <div>
      <span>result-step words={selectedWords.join(',')} tribe={tribe}</span>
      <button onClick={onBack}>back-to-label</button>
      <button onClick={onRestart}>restart</button>
    </div>
  ),
}));

const selectFile = (file) => {
  const input = screen.getByLabelText('選擇圖片檔案');
  fireEvent.change(input, { target: { files: [file] } });
};

describe('CameraWizard（回歸測試：FileReader race）', () => {
  class FakeFileReader {
    readAsDataURL(file) {
      this.file = file;
      FakeFileReader.instances.push(this);
    }
    triggerLoad(result) {
      this.result = result;
      this.done = true;
      this.onloadend?.();
    }
    // 跟真的 FileReader 一樣：讀完之後 abort 沒有作用；還沒讀完才會中止，
    // 而且會「同步」觸發 abort 與 loadend 事件，result 變成 null
    abort() {
      if (this.done) return;
      this.aborted = true;
      this.done = true;
      this.result = null;
      this.onabort?.();
      this.onloadend?.();
    }
  }
  FakeFileReader.instances = [];
  let OriginalFileReader;

  beforeEach(() => {
    FakeFileReader.instances = [];
    OriginalFileReader = window.FileReader;
    window.FileReader = FakeFileReader;
  });

  afterEach(() => {
    window.FileReader = OriginalFileReader;
  });

  test('快速選圖 A 再選圖 B，B 的 FileReader 先讀完、A 比較晚讀完時，畫面仍然顯示 B（不會被過期的 A 蓋回去）', () => {
    render(<CameraWizard />);

    const fileA = new File(['a'], 'a.png', { type: 'image/png' });
    const fileB = new File(['b'], 'b.png', { type: 'image/png' });

    selectFile(fileA);
    selectFile(fileB);

    expect(FakeFileReader.instances).toHaveLength(2);
    const [readerA, readerB] = FakeFileReader.instances;

    act(() => { readerB.triggerLoad('data:image/png;base64,B'); });
    expect(document.querySelector('img[alt="預覽圖片"]').src).toContain('base64,B');

    act(() => { readerA.triggerLoad('data:image/png;base64,A'); }); // 過期的 A 這時候才讀完
    expect(document.querySelector('img[alt="預覽圖片"]').src).toContain('base64,B');
  });

  // F18：換圖時中止上一個讀檔、離開頁面時中止最後一個，不讓它白白做完
  test('換選另一張圖時，還沒讀完的上一張會被中止；已經讀完的不受影響', () => {
    render(<CameraWizard />);
    selectFile(new File(['a'], 'a.png', { type: 'image/png' }));
    selectFile(new File(['b'], 'b.png', { type: 'image/png' }));
    const [readerA, readerB] = FakeFileReader.instances;
    expect(readerA.aborted).toBe(true);
    expect(readerB.aborted).toBeUndefined();

    act(() => { readerB.triggerLoad('data:image/png;base64,B'); });
    selectFile(new File(['c'], 'c.png', { type: 'image/png' }));
    expect(readerB.aborted).toBeUndefined();     // B 已讀完，abort 沒有作用
  });

  test('換圖中止上一張時，預覽不會被清掉（abort 會同步觸發舊讀檔的 loadend）', () => {
    render(<CameraWizard />);
    selectFile(new File(['p'], 'p.png', { type: 'image/png' }));
    act(() => { FakeFileReader.instances[0].triggerLoad('data:image/png;base64,P'); });
    expect(document.querySelector('img[alt="預覽圖片"]').src).toContain('base64,P');

    selectFile(new File(['a'], 'a.png', { type: 'image/png' }));      // A 還在讀
    selectFile(new File(['b'], 'b.png', { type: 'image/png' }));      // 選 B：中止 A
    expect(FakeFileReader.instances[1].aborted).toBe(true);
    expect(document.querySelector('img[alt="預覽圖片"]').src).toContain('base64,P');   // 沒有被 A 的 loadend 清成空白

    act(() => { FakeFileReader.instances[2].triggerLoad('data:image/png;base64,B'); });
    expect(document.querySelector('img[alt="預覽圖片"]').src).toContain('base64,B');
  });

  test('離開頁面（元件卸載）時，還在讀的檔案會被中止，之後讀完也不再更新畫面', () => {
    const { unmount } = render(<CameraWizard />);
    selectFile(new File(['a'], 'a.png', { type: 'image/png' }));
    const [reader] = FakeFileReader.instances;
    unmount();
    expect(reader.aborted).toBe(true);
    expect(() => reader.triggerLoad('data:image/png;base64,A')).not.toThrow();
  });

  test('沒有選過圖就離開頁面：不會出錯', () => {
    const { unmount } = render(<CameraWizard />);
    expect(() => unmount()).not.toThrow();
  });
});

describe('CameraWizard', () => {
  test('第 1 步：選圖前，提交辨識按鈕是 disabled', () => {
    render(<CameraWizard />);
    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();
  });

  test('縮小後仍超過 5MB 的圖片會顯示錯誤、清掉預覽，不會進到下一步（FE3-11：5MB 改在縮圖後才判斷）', async () => {
    prepareImageForUpload.mockRejectedValueOnce(new ImageUploadError('TOO_LARGE', '圖片不得超過 5 MB，請重新選擇。'));
    render(<CameraWizard />);

    selectFile(new File(['x'], 'big.png', { type: 'image/png' }));

    expect(await screen.findByText('圖片不得超過 5 MB，請重新選擇。')).toBeInTheDocument();
    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();
    expect(screen.getByText('請選擇圖片')).toBeInTheDocument();
  });

  test('原檔超過 5MB 但縮小後合格：照常可以提交，上傳的是縮小後的檔案（FE3-11、FE3-12）', async () => {
    const small = new File(['s'], 'big.jpg', { type: 'image/jpeg' });
    prepareImageForUpload.mockResolvedValueOnce(small);
    render(<CameraWizard />);
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });

    selectFile(big);

    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
    expect(prepareImageForUpload).toHaveBeenCalledWith(big);
    expect(screen.queryByText(/不得超過 5 MB/)).not.toBeInTheDocument();
  });

  test('處理中（縮圖還沒完成）時提交鈕維持停用，並有狀態說明（FE3-11）', async () => {
    let finish;
    prepareImageForUpload.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<CameraWizard />);
    selectFile(new File(['x'], 'slow.png', { type: 'image/png' }));
    await screen.findByText('正在縮小圖片…');
    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();
    finish(new File(['x'], 'slow.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
    expect(screen.queryByText('正在縮小圖片…')).not.toBeInTheDocument();
  });

  test('拖放、貼上、拍照入口都經過同一個縮圖處理（FE3-12）', async () => {
    prepareImageForUpload.mockClear();
    const { container } = render(<CameraWizard />);
    fireEvent.drop(container.querySelector('.camera-dropzone'), { dataTransfer: { types: ['Files'], files: [new File(['x'], 'd.png', { type: 'image/png' })] } });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { files: [new File(['x'], 'p.png', { type: 'image/png' })] };
    document.dispatchEvent(paste);
    fireEvent.change(screen.getByLabelText('拍照', { selector: 'input' }), { target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(prepareImageForUpload).toHaveBeenCalledTimes(3));
  });

  test('選好圖片後可以進入第 2 步，選字後可以進入第 3 步並帶上選字結果', async () => {
    render(<CameraWizard />);
    const file = new File(['x'], 'ok.png', { type: 'image/png' });

    selectFile(file);
    // handleImageChange 用 FileReader 非同步讀檔才 setImage，「提交辨識」按鈕的
    // disabled={!image} 要等 FileReader 的 onloadend 跑完才會變成可點選。
    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
    fireEvent.click(screen.getByText('提交辨識 ▸'));
    // 第 2、3 步改成 lazy load，包在 Suspense 底下，即使模組本身已被 mock，
    // dynamic import() 仍是非同步的，掛載後要等一個 microtask 才會真的出現。
    await waitFor(() => expect(screen.getByText('label-step')).toBeInTheDocument());

    fireEvent.click(screen.getByText('confirm-label'));
    await waitFor(() => expect(screen.getByText(/result-step words=balay tribe=tayal/)).toBeInTheDocument());
  });

  test('第 3 步按下重新辨識，會清空狀態回到第 1 步', async () => {
    render(<CameraWizard />);
    const file = new File(['x'], 'ok.png', { type: 'image/png' });

    selectFile(file);
    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
    fireEvent.click(screen.getByText('提交辨識 ▸'));
    await waitFor(() => expect(screen.getByText('label-step')).toBeInTheDocument());
    fireEvent.click(screen.getByText('confirm-label'));
    await waitFor(() => expect(screen.getByText(/result-step/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('restart'));

    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();
    expect(screen.getByText('請選擇圖片')).toBeInTheDocument();
  });
});

describe('CameraWizard 的入口與說明（E-4）', () => {
  test('第 1 步有隱私說明，也不再顯示族語選擇（族語在結果頁才有作用）', () => {
    render(<CameraWizard />);
    expect(screen.getByText(/Google Cloud Vision/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '查詢的族語' })).not.toBeInTheDocument();
  });

  test('相簿入口不帶 capture，拍照入口才帶 capture=environment', () => {
    render(<CameraWizard />);
    expect(screen.getByLabelText('選擇圖片檔案')).not.toHaveAttribute('capture');
    expect(screen.getByLabelText('拍照', { selector: 'input' })).toHaveAttribute('capture', 'environment');
  });

  test('結果頁按「回到選詞」會回到第 2 步，不用重新上傳', async () => {
    render(<CameraWizard />);
    selectFile(new File(['x'], 'ok.png', { type: 'image/png' }));
    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
    fireEvent.click(screen.getByText('提交辨識 ▸'));
    await waitFor(() => expect(screen.getByText('label-step')).toBeInTheDocument());
    fireEvent.click(screen.getByText('confirm-label'));
    await waitFor(() => expect(screen.getByText(/result-step/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('back-to-label'));
    await waitFor(() => expect(screen.getByText('label-step')).toBeInTheDocument());
  });
});

describe('CameraWizard 的取景框提示（Apple 化步驟 4-4、P3-5）', () => {
  test('不再有分頁式的步驟條：狀態改由舞台上的文字提示說明', () => {
    const { container } = render(<CameraWizard />);
    expect(container.querySelector('.yy-stepbar')).toBeNull();
  });

  test('取景框上有玻璃提示，還沒選圖時說明要做什麼；提示不進無障礙樹（真正的標籤是上傳區的文字）', () => {
    const { container } = render(<CameraWizard />);
    const hint = container.querySelector('.camera-dropzone-hint');
    expect(hint).toHaveClass('yy-glass');
    expect(hint).toHaveAttribute('aria-hidden', 'true');
    expect(hint).toHaveTextContent('把想辨識的物件放在框內');
  });
});
