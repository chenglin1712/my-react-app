import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RichTextEditor from './RichTextEditor';

const DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '既有內文' }] }] };
const media = (over) => ({ uploadingKey: null, error: '', upload: vi.fn(), ...over });

describe('RichTextEditor', () => {
  test('載入既有文件，工具列有排版、清單、連結、圖片按鈕', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    expect(await screen.findByText('既有內文')).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: '文章格式工具列' });
    ['粗體', '斜體', '底線', '刪除線', '上標', '下標', '文字顏色', '螢光筆', '清除格式', '靠左對齊', '置中對齊', '靠右對齊', '左右對齊',
      '項目清單', '編號清單', '待辦清單', '引用', '重點提示框', '分隔線', '連結', '插入圖片', '插入影片', '插入表格', '復原', '重做', '預覽', '全螢幕', '快捷鍵說明'].forEach((name) => {
      expect(toolbar.querySelector(`button[aria-label="${name}"]`), name).not.toBeNull();
    });
    expect(screen.getByRole('combobox', { name: '段落樣式' })).toHaveValue('p');
    expect(screen.getByRole('combobox', { name: '字級' })).toBeInTheDocument();
    expect(screen.getByText('字數 4')).toBeInTheDocument();
  });

  test('常用按鈕有文字標籤，不是只有圖示', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    await screen.findByText('既有內文');
    const toolbar = screen.getByRole('toolbar');
    ['連結', '圖片', '影片', '表格', '提示框', '預覽', '全螢幕'].forEach((text) => expect(toolbar).toHaveTextContent(text));
  });

  test('段落樣式下拉：改成大標題後輸出的文件是 level 2 標題', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={DOC} onChange={onChange} media={media()} />);
    await screen.findByText('既有內文');
    fireEvent.change(screen.getByRole('combobox', { name: '段落樣式' }), { target: { value: 'h2' } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.lastCall[0].content[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } });
  });

  test('插入表格後出現表格工具列，且第一列是標題列', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={DOC} onChange={onChange} media={media()} />);
    await screen.findByText('既有內文');
    fireEvent.click(screen.getByRole('button', { name: '插入表格' }));
    expect(await screen.findByRole('group', { name: '表格設定' })).toBeInTheDocument();
    expect(JSON.stringify(onChange.mock.lastCall[0])).toContain('tableHeader');

  });

  test('YouTube：貼上正確網址會插入只含影片代號的節點', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={DOC} onChange={onChange} media={media()} />);
    await screen.findByText('既有內文');
    fireEvent.click(screen.getByRole('button', { name: '插入影片' }));
    const input = screen.getByLabelText('YouTube 影片網址');
    fireEvent.change(input, { target: { value: 'https://evil.example/watch?v=dQw4w9WgXcQ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('YouTube');
    fireEvent.change(input, { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(JSON.stringify(onChange.mock.lastCall?.[0])).toContain('"videoId":"dQw4w9WgXcQ"'));
    expect(JSON.stringify(onChange.mock.lastCall[0])).not.toContain('youtu.be');
  });

  test('文字顏色與螢光筆面板只有固定色票', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    await screen.findByText('既有內文');
    fireEvent.click(screen.getByRole('button', { name: '文字顏色' }));
    expect(within(screen.getByRole('group', { name: '文字顏色' })).getAllByRole('button')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: '螢光筆' }));
    expect(within(screen.getByRole('group', { name: '螢光筆' })).getAllByRole('button')).toHaveLength(6);
  });

  test('預覽：顯示排版結果且不能編輯，回到編輯後還原', async () => {
    render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    await screen.findByText('既有內文');
    fireEvent.click(screen.getByRole('button', { name: '預覽' }));
    expect(screen.getByText(/預覽中/)).toBeInTheDocument();
    expect(screen.getByLabelText('排版預覽')).toHaveTextContent('既有內文');
    expect(screen.queryByRole('button', { name: '粗體' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回到編輯' }));
    expect(screen.getByRole('button', { name: '粗體' })).toBeInTheDocument();
  });

  test('全螢幕：Esc 離開；快捷鍵面板可開關', async () => {
    const { container } = render(<RichTextEditor value={DOC} onChange={() => {}} media={media()} />);
    await screen.findByText('既有內文');
    fireEvent.click(screen.getByRole('button', { name: '全螢幕' }));
    expect(container.querySelector('.rte.is-fullscreen')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '快捷鍵說明' }));
    expect(screen.getByRole('group', { name: '快捷鍵說明' })).toHaveTextContent('Ctrl + B');
    fireEvent.keyDown(container.querySelector('.rte'), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: '快捷鍵說明' })).toBeNull();
    expect(container.querySelector('.rte.is-fullscreen')).not.toBeNull();
    fireEvent.keyDown(container.querySelector('.rte'), { key: 'Escape' });
    expect(container.querySelector('.rte.is-fullscreen')).toBeNull();
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
