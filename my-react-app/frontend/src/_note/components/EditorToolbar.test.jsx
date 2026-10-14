import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EditorToolbar from './EditorToolbar';

afterEach(() => { document.body.innerHTML = ''; });

describe('EditorToolbar（筆記工具列）', () => {
    test('釘在全站導覽列下方：top 取導覽列實際高度，不是 0（0 會被導覽列蓋住）', () => {
        document.body.innerHTML = '<nav class="navbar"></nav>';
        Object.defineProperty(document.querySelector('.navbar'), 'offsetHeight', { value: 72 });
        const { container } = render(<EditorToolbar execStyle={vi.fn()} onImageFileSelected={vi.fn()} isUploadingImage={false} />);
        expect(container.querySelector('.editor-toolbar').style.top).toBe('72px');
    });

    test('找不到導覽列時退回預設高度，工具列仍可操作', () => {
        const execStyle = vi.fn();
        render(<EditorToolbar execStyle={execStyle} onImageFileSelected={vi.fn()} isUploadingImage={false} />);
        fireEvent.click(screen.getByRole('button', { name: '粗體' }));
        expect(execStyle).toHaveBeenCalledWith('bold');
    });

    test('文字顏色色票：套用品牌色碼，並以 aria-pressed 標示剛選的顏色', () => {
        const execStyle = vi.fn();
        render(<EditorToolbar execStyle={execStyle} onImageFileSelected={vi.fn()} isUploadingImage={false} />);
        const red = screen.getByRole('button', { name: '文字顏色：紅色' });
        expect(red).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(red);
        expect(execStyle).toHaveBeenCalledWith('foreColor', '#9E1B24');
        expect(red).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '文字顏色：藍色' })).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('EditorToolbar 粗斜體（E-7，P3-27）', () => {
    test('粗體與斜體是圖示按鈕（不是數學字母符號），有 aria-pressed 並在點擊後切換', () => {
        const execStyle = vi.fn();
        render(<EditorToolbar execStyle={execStyle} onImageFileSelected={vi.fn()} isUploadingImage={false} />);
        const bold = screen.getByRole('button', { name: '粗體' });
        const italic = screen.getByRole('button', { name: '斜體' });

        expect(bold.textContent).toBe('');
        expect(bold.querySelector('svg')).not.toBeNull();
        expect(bold).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(bold);
        expect(execStyle).toHaveBeenCalledWith('bold');
        expect(bold).toHaveAttribute('aria-pressed', 'true');
        expect(italic).toHaveAttribute('aria-pressed', 'false');
    });
});
