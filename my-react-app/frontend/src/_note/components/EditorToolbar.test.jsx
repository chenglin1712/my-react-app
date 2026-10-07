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
});
