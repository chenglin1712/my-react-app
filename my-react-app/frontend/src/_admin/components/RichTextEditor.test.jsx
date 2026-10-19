import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RichTextEditor from './RichTextEditor';

const DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '既有內文' }] }] };
const media = (over) => ({ uploadingKey: null, error: '', upload: vi.fn(), ...over });

describe('RichTextEditor', () => {
  test('載入既有文件，工具列有排版、清單、連結、圖片按鈕', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    expect(await screen.findByText('既有內文')).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: '文章格式工具列' });
    ['大標題', '小標題', '粗體', '斜體', '底線', '刪除線', '項目清單', '編號清單', '引用', '分隔線', '連結', '插入圖片', '復原', '重做'].forEach((name) => {
      expect(toolbar.querySelector(`button[aria-label="${name}"]`), name).not.toBeNull();
    });
  });

  test('唯讀時沒有工具列，內容仍可閱讀', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} disabled media={media()} />);
    expect(await screen.findByText('既有內文')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  test('工具列方向鍵在按鈕間移動，Home／End 到頭尾', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    await screen.findByText('既有內文');
    const toolbar = screen.getByRole('toolbar');
    const buttons = [...toolbar.querySelectorAll('button:not(:disabled)')];
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1], { key: 'End' });
    expect(document.activeElement).toBe(buttons.at(-1));
    fireEvent.keyDown(buttons.at(-1), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0], { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
  });

  test('選擇圖片檔會交給上傳流程（key 固定為 article-image）', async () => {
    const m = media();
    const { container } = render(<RichTextEditor value={DOC} onChange={() => {}} media={m} />);
    await screen.findByText('既有內文');
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    expect(m.upload).toHaveBeenCalledWith(file, 'article-image', expect.objectContaining({ onUploaded: expect.any(Function) }));
  });

  test('上傳中顯示狀態、上傳失敗顯示錯誤', async () => {
    const { rerender } = render(<RichTextEditor value={DOC} onChange={() => {}} media={media({ uploadingKey: 'article-image' })} />);
    expect(await screen.findByRole('status')).toHaveTextContent('圖片上傳中');
    rerender(<RichTextEditor value={DOC} onChange={() => {}} media={media({ error: '上傳失敗，請重新選擇檔案。' })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('上傳失敗');
  });

  test('連結：不安全的網址被擋下並說明原因', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    await screen.findByText('既有內文');
    fireEvent.click(screen.getByRole('button', { name: '連結' }));
    fireEvent.change(screen.getByLabelText('連結網址'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: '套用' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('站內路徑'));
  });

  test('連結：沒有選取文字就套用會提示先選取', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    await screen.findByText('既有內文');
    fireEvent.click(screen.getByRole('button', { name: '連結' }));
    fireEvent.change(screen.getByLabelText('連結網址'), { target: { value: 'https://example.org' } });
    fireEvent.click(screen.getByRole('button', { name: '套用' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('先選取'));
  });
});
