import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    expect(screen.getByText('label-step')).toBeInTheDocument();

    fireEvent.click(screen.getByText('confirm-label'));
    expect(screen.getByText(/result-step words=balay tribe=tayal/)).toBeInTheDocument();
  });

  test('第 3 步按下重新辨識，會清空狀態回到第 1 步', async () => {
    render(<CameraWizard />);
    const file = new File(['x'], 'ok.png', { type: 'image/png' });

    selectFile(file);
    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
    fireEvent.click(screen.getByText('提交辨識 ▸'));
    fireEvent.click(screen.getByText('confirm-label'));
    expect(screen.getByText(/result-step/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('restart'));

    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();
    expect(screen.getByText('請選擇圖片')).toBeInTheDocument();
  });
});
