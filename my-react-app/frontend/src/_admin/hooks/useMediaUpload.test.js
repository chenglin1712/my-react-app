import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useMediaUpload } from './useMediaUpload';
import { uploadToCloudinary } from '@utils/uploadToCloudinary';

vi.mock('@utils/uploadToCloudinary', () => ({
    uploadToCloudinary: vi.fn(),
}));

const makeFile = (size = 1024) => {
    const file = new File(['x'.repeat(size)], 'photo.jpg', { type: 'image/jpeg' });
    return file;
};

describe('useMediaUpload', () => {
    beforeEach(() => {
        uploadToCloudinary.mockReset();
        vi.stubGlobal('URL', {
            ...URL,
            createObjectURL: vi.fn(() => 'blob:preview'),
            revokeObjectURL: vi.fn(),
        });
    });

    test('檔案超過大小限制時不會呼叫上傳，並顯示錯誤訊息', async () => {
        const { result } = renderHook(() => useMediaUpload({ maxFileSize: 100 }));

        await act(async () => {
            await result.current.upload(makeFile(200), 'cover');
        });

        expect(uploadToCloudinary).not.toHaveBeenCalled();
        expect(result.current.error).toContain('不得超過');
    });

    test('上傳成功後呼叫 onUploaded，並更新 previews', async () => {
        uploadToCloudinary.mockResolvedValue('https://cdn.example.com/a.jpg');
        const { result } = renderHook(() => useMediaUpload());
        const onUploaded = vi.fn();

        await act(async () => {
            await result.current.upload(makeFile(), 'cover', { onUploaded });
        });

        expect(onUploaded).toHaveBeenCalledWith('https://cdn.example.com/a.jpg');
        expect(result.current.previews.cover).toBe('https://cdn.example.com/a.jpg');
        expect(result.current.isUploading('cover')).toBe(false);
    });

    /** 回歸測試：快速換選兩個檔案時，較舊的上傳結果不能覆蓋較新那次選檔
     * 的 preview／表單值。 */
    test('較舊的上傳晚回來時，不會呼叫 onUploaded 覆蓋較新的上傳結果', async () => {
        let resolveFirst;
        uploadToCloudinary
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValueOnce('https://cdn.example.com/second.jpg');

        const { result } = renderHook(() => useMediaUpload());
        const onUploaded = vi.fn();

        act(() => {
            result.current.upload(makeFile(), 'cover', { onUploaded });
        });

        await act(async () => {
            await result.current.upload(makeFile(), 'cover', { onUploaded });
        });

        expect(onUploaded).toHaveBeenCalledTimes(1);
        expect(onUploaded).toHaveBeenCalledWith('https://cdn.example.com/second.jpg');

        await act(async () => {
            resolveFirst('https://cdn.example.com/first.jpg');
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onUploaded).toHaveBeenCalledTimes(1);
        expect(result.current.previews.cover).toBe('https://cdn.example.com/second.jpg');
    });

    /** 回歸測試：resetKey 改變（切換編輯目標）後，前一個目標還在飛的上傳
     * 結果不能再寫進現在正在編輯的另一筆表單。 */
    test('resetKey 改變後，前一個目標的上傳結果不再呼叫 onUploaded', async () => {
        let resolveUpload;
        uploadToCloudinary.mockImplementation(
            () => new Promise((resolve) => { resolveUpload = resolve; }),
        );

        const { result, rerender } = renderHook(
            ({ resetKey }) => useMediaUpload({ resetKey }),
            { initialProps: { resetKey: 'item-a' } },
        );
        const onUploaded = vi.fn();

        act(() => {
            result.current.upload(makeFile(), 'cover', { onUploaded });
        });

        rerender({ resetKey: 'item-b' });

        await act(async () => {
            resolveUpload('https://cdn.example.com/a.jpg');
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(onUploaded).not.toHaveBeenCalled();
    });

    test('localPreview 為 true 時會先顯示本地物件網址，上傳成功後換成正式網址並 revoke', async () => {
        uploadToCloudinary.mockResolvedValue('https://cdn.example.com/a.jpg');
        const { result } = renderHook(() => useMediaUpload());

        await act(async () => {
            await result.current.upload(makeFile(), 'cover', { localPreview: true });
        });

        expect(URL.createObjectURL).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
        expect(result.current.previews.cover).toBe('https://cdn.example.com/a.jpg');
    });

    test('上傳失敗時顯示錯誤，不呼叫 onUploaded', async () => {
        uploadToCloudinary.mockRejectedValue(new Error('network error'));
        const { result } = renderHook(() => useMediaUpload());
        const onUploaded = vi.fn();

        await act(async () => {
            await result.current.upload(makeFile(), 'cover', { onUploaded });
        });

        await waitFor(() => {
            expect(result.current.error).toBe('上傳失敗，請重新選擇檔案。');
        });
        expect(onUploaded).not.toHaveBeenCalled();
        expect(result.current.isUploading('cover')).toBe(false);
    });
});
