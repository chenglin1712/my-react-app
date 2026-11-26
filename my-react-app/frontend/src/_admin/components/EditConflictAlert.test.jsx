import { afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import EditConflictAlert, { MyVersionBackupNotice } from './EditConflictAlert';

describe('EditConflictAlert（稽核 FE7b-08）', () => {
    test('顯示「有人剛更新過」與「載入最新版本」，按下呼叫 onReload', () => {
        const onReload = vi.fn();
        render(<EditConflictAlert onReload={onReload} />);

        expect(screen.getByRole('alert')).toHaveTextContent('有人剛更新過');
        fireEvent.click(screen.getByRole('button', { name: '載入最新版本' }));
        expect(onReload).toHaveBeenCalledTimes(1);
    });

    test('載入中按鈕停用並改顯示「載入中…」；可帶補充說明', () => {
        render(<EditConflictAlert onReload={() => {}} busy>「某規則」已被更新。</EditConflictAlert>);
        expect(screen.getByRole('button', { name: '載入中…' })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('「某規則」已被更新。');
    });

    test('沒有帶 myVersionText 時不顯示「複製我的版本」', () => {
        render(<EditConflictAlert onReload={() => {}} />);
        expect(screen.queryByRole('button', { name: '複製我的版本' })).not.toBeInTheDocument();
    });
});

// WP-8 追加：載入最新版本會整份換掉，至少要能帶走自己的內容
describe('EditConflictAlert：複製我的版本', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const setClipboard = (value) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
    afterEach(() => {
        if (original) Object.defineProperty(navigator, 'clipboard', original);
        else delete navigator.clipboard;
    });

    test('按「複製我的版本」把文字寫進剪貼簿並提示已複製', async () => {
        const writeText = vi.fn().mockResolvedValue();
        setClipboard({ writeText });
        render(<EditConflictAlert onReload={() => {}} myVersionText="我的內文" />);

        fireEvent.click(screen.getByRole('button', { name: '複製我的版本' }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith('我的內文'));
        expect(await screen.findByText('已複製到剪貼簿')).toBeInTheDocument();
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    test('剪貼簿失敗時退回顯示可全選的唯讀文字框', async () => {
        setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
        render(<EditConflictAlert onReload={() => {}} myVersionText="我的內文" />);

        fireEvent.click(screen.getByRole('button', { name: '複製我的版本' }));
        const area = await screen.findByRole('textbox');
        expect(area).toHaveValue('我的內文');
        expect(area).toHaveAttribute('readonly');
        expect(screen.queryByText('已複製到剪貼簿')).not.toBeInTheDocument();
    });

    test('沒有 clipboard API 時同樣退回文字框', async () => {
        setClipboard(undefined);
        render(<EditConflictAlert onReload={() => {}} myVersionText="我的內文" />);
        fireEvent.click(screen.getByRole('button', { name: '複製我的版本' }));
        expect(await screen.findByRole('textbox')).toHaveValue('我的內文');
    });

    test('按「載入最新版本」時先用 onStash 交出目前內容，再呼叫 onReload', () => {
        const calls = [];
        render(
            <EditConflictAlert
                onReload={() => calls.push('reload')}
                onStash={(text) => calls.push(`stash:${text}`)}
                myVersionText="我的內文"
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '載入最新版本' }));
        expect(calls).toEqual(['stash:我的內文', 'reload']);
    });
});

describe('MyVersionBackupNotice', () => {
    test('沒有暫存內容時不顯示任何東西', () => {
        const { container } = render(<MyVersionBackupNotice text="" onDismiss={() => {}} />);
        expect(container).toBeEmptyDOMElement();
    });

    test('有暫存內容時提供複製，關閉按鈕呼叫 onDismiss', () => {
        const onDismiss = vi.fn();
        render(<MyVersionBackupNotice text="舊內容" onDismiss={onDismiss} />);
        expect(screen.getByRole('button', { name: '複製我的版本' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '關閉' }));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
