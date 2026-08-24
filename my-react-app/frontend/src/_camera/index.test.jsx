import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CameraWizard from './index';

// 精靈容器本身只負責 step 切換與圖片驗證，實際辨識/查詢邏輯在 label.jsx／result.jsx
// 各自的測試（label.test.jsx／result.test.jsx）裡驗證，這裡把兩步都換成簡單的樁元件，
// 只驗證 index.jsx 自己的職責：step 切換、image/file 傳遞、5MB 大小驗證。
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
  default: ({ selectedWords, tribe, onRestart }) => (
    <div>
      <span>result-step words={selectedWords.join(',')} tribe={tribe}</span>
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
});

describe('CameraWizard', () => {
  test('第 1 步：選圖前，提交辨識按鈕是 disabled', () => {
    render(<CameraWizard />);
    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();
  });

  test('超過 5MB 的圖片會顯示錯誤，不會進到下一步', () => {
    render(<CameraWizard />);
    const bigFile = new File(['x'.repeat(10)], 'big.png', { type: 'image/png' });
    Object.defineProperty(bigFile, 'size', { value: 6 * 1024 * 1024 });

    selectFile(bigFile);

    expect(screen.getByText('圖片不得超過 5 MB，請重新選擇。')).toBeInTheDocument();
    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();
  });

  test('選好圖片後可以進入第 2 步，選字後可以進入第 3 步並帶上選字結果', async () => {
    render(<CameraWizard />);
    const file = new File(['x'], 'ok.png', { type: 'image/png' });

    selectFile(file);
    // handleImageChange 用 FileReader 非同步讀檔才 setImage，「提交辨識」按鈕的
    // disabled={!image} 要等 FileReader 的 onloadend 跑完才會變成可點擊。
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
