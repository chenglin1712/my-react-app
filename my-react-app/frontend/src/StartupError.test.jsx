import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import StartupError from './StartupError';

describe('啟動失敗畫面', () => {
    test('顯示說明與重新整理按鈕，且不需要任何樣式或路由就能運作', () => {
        render(<StartupError />);
        expect(screen.getByRole('alert')).toHaveTextContent('系統暫時無法啟動');
        expect(screen.getByRole('button', { name: '重新整理' })).toBeInTheDocument();
    });

    test('稽核 FE1-22：用象牙底與銅褐按鈕，不再用舊版紅色；全畫面無襯線，只有品牌字標用宋體', () => {
        const { container } = render(<StartupError />);
        const root = screen.getByRole('alert');
        const button = screen.getByRole('button', { name: '重新整理' });
        expect(root.style.background).toBe('rgb(255, 249, 237)'); // #FFF9ED
        expect(button.style.background).toBe('rgb(126, 82, 57)'); // #7E5239，站內主要按鈕底色
        expect(container.innerHTML).not.toMatch(/9E1B24|rgb\(158, 27, 36\)|F3E7CF|rgb\(243, 231, 207\)/i);

        expect(root.style.fontFamily).toMatch(/sans-serif$/);
        const serifElements = [...container.querySelectorAll('[style]')]
            .filter((el) => /(^|,\s*)serif$/.test(el.style.fontFamily));
        expect(serifElements).toHaveLength(1);
        expect(serifElements[0]).toHaveTextContent('原語');
        expect(serifElements[0]).toHaveAttribute('aria-hidden', 'true');
    });
});
