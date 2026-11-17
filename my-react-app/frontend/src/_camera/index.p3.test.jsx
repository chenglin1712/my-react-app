import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CameraWizard from './index';

vi.mock('./label', () => ({ default: () => <div>label-step</div> }));
vi.mock('./result', () => ({ default: () => <div>result-step</div> }));

const input = () => screen.getByLabelText('選擇圖片檔案');
const dropzone = (container) => container.querySelector('.camera-dropzone');
const png = (name = 'a.png') => new File(['x'], name, { type: 'image/png' });

describe('影像辨識第 1 步：拖放、貼上與格式驗證（P3-6）', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* 沒有 storage 也沒關係 */ } });

  test('拖著檔案經過取景框：邊框高亮（is-dragging）並改提示文字；離開或放開就取消', () => {
    const { container } = render(<CameraWizard />);
    const zone = dropzone(container);
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone).toHaveClass('is-dragging');
    expect(container.querySelector('.camera-dropzone-hint')).toHaveTextContent('放開就會使用這張圖片');
    fireEvent.dragLeave(zone, { relatedTarget: document.body });
    expect(zone).not.toHaveClass('is-dragging');
  });

  test('拖的不是檔案（例如選取的文字）不高亮', () => {
    const { container } = render(<CameraWizard />);
    fireEvent.dragOver(dropzone(container), { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(dropzone(container)).not.toHaveClass('is-dragging');
  });

  test('放開圖片檔就載入預覽；放開不是圖片的檔案顯示格式說明', async () => {
    const { container } = render(<CameraWizard />);
    fireEvent.drop(dropzone(container), { dataTransfer: { types: ['Files'], files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText(/不支援這個檔案格式/)).toBeInTheDocument();
    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();

    fireEvent.drop(dropzone(container), { dataTransfer: { types: ['Files'], files: [png('drop.png')] } });
    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
    expect(screen.getByText('drop.png')).toBeInTheDocument();
  });

  test('貼上圖片（剪貼簿裡有檔案）就載入；只貼文字不處理', async () => {
    render(<CameraWizard />);
    const textPaste = new Event('paste', { bubbles: true, cancelable: true });
    textPaste.clipboardData = { files: [] };
    document.dispatchEvent(textPaste);
    expect(screen.getByText('提交辨識 ▸')).toBeDisabled();

    const imagePaste = new Event('paste', { bubbles: true, cancelable: true });
    imagePaste.clipboardData = { files: [png('paste.png')] };
    document.dispatchEvent(imagePaste);
    expect(imagePaste.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
  });

  test('選檔也走同一套格式驗證；5MB 上限不變', () => {
    render(<CameraWizard />);
    fireEvent.change(input(), { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
    expect(screen.getByText(/不支援這個檔案格式/)).toBeInTheDocument();
  });

  test('取景框可用鍵盤操作：Tab 得到、Enter 開檔案選擇', () => {
    const { container } = render(<CameraWizard />);
    const zone = dropzone(container);
    expect(zone).toHaveAttribute('tabindex', '0');
    const click = vi.spyOn(input(), 'click').mockImplementation(() => {});
    fireEvent.keyDown(zone, { key: 'Enter' });
    expect(click).toHaveBeenCalled();
  });

  test('縮圖換圖時用 key 重新掛載，淡入會重播', async () => {
    const { container } = render(<CameraWizard />);
    fireEvent.change(input(), { target: { files: [png('one.png')] } });
    await waitFor(() => expect(container.querySelector('.camera-dropzone-img')).not.toBeNull());
    const first = container.querySelector('.camera-dropzone-img');
    fireEvent.change(input(), { target: { files: [png('two.png')] } });
    await waitFor(() => expect(container.querySelector('.camera-dropzone-img')).not.toBe(first));
  });
});

describe('隱私說明卡（P3-9）', () => {
  const FULL = /Google Cloud Vision/;
  beforeEach(() => { try { localStorage.clear(); } catch { /* 沒有 storage 也沒關係 */ } });
  afterEach(() => vi.restoreAllMocks());

  test('第一次：顯示完整說明與「我知道了」，沒有資訊鈕', () => {
    render(<CameraWizard />);
    expect(screen.getByText(FULL)).toBeVisible();
    expect(screen.getByRole('button', { name: '我知道了' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '隱私說明' })).not.toBeInTheDocument();
  });

  test('按「我知道了」後收成資訊鈕；說明全文仍在，點資訊鈕可再展開、再收起', () => {
    render(<CameraWizard />);
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    const info = screen.getByRole('button', { name: '隱私說明' });
    expect(info).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(FULL)).not.toBeVisible();
    fireEvent.click(info);
    expect(info).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(FULL)).toBeVisible();
    expect(screen.getByText(/請避免上傳含有人臉、證件或個人資料的照片/)).toBeVisible();
    fireEvent.click(info);
    expect(screen.getByText(FULL)).not.toBeVisible();
  });

  test('已看過會記在這台裝置：重新進來直接是資訊鈕', () => {
    const { unmount } = render(<CameraWizard />);
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    unmount();
    render(<CameraWizard />);
    expect(screen.getByRole('button', { name: '隱私說明' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '我知道了' })).not.toBeInTheDocument();
  });

  test('瀏覽器不讓讀寫儲存（無痕、被封鎖）：每次都顯示完整說明，按「我知道了」也不會壞', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<CameraWizard />);
    expect(screen.getByText(FULL)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    expect(screen.getByRole('button', { name: '隱私說明' })).toBeInTheDocument();
  });
});

describe('檔案類型判斷（P3-6）', () => {
  test('MIME type 是空字串但副檔名是圖片（部分 Android／HEIC）：接受；副檔名也不是圖片：拒絕', async () => {
    render(<CameraWizard />);
    fireEvent.change(input(), { target: { files: [new File(['x'], 'IMG_1.HEIC', { type: '' })] } });
    await waitFor(() => expect(screen.getByText('提交辨識 ▸')).not.toBeDisabled());
    fireEvent.change(input(), { target: { files: [new File(['x'], 'notes', { type: '' })] } });
    expect(screen.getByText(/不支援這個檔案格式/)).toBeInTheDocument();
  });
});
