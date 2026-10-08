import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import StartupError from './StartupError';

describe('啟動失敗畫面', () => {
    test('顯示說明與重新整理按鈕，且不需要任何樣式或路由就能運作', () => {
        render(<StartupError />);
        expect(screen.getByRole('alert')).toHaveTextContent('系統暫時無法啟動');
        expect(screen.getByRole('button', { name: '重新整理' })).toBeInTheDocument();
    });
});
