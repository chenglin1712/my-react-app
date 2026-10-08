import { describe, expect, test } from 'vitest';
import { useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFocusTrap } from './useFocusTrap';

const Dialog = ({ open }) => {
    const ref = useRef(null);
    useFocusTrap(ref, open);
    if (!open) return null;
    return (
        <div ref={ref} tabIndex={-1} role="dialog">
            <button>第一個</button>
            <button>最後一個</button>
        </div>
    );
};

const Page = ({ open }) => (
    <>
        <button>背景按鈕</button>
        <Dialog open={open} />
    </>
);

describe('useFocusTrap', () => {
    test('Tab 在最後一個元素時回到第一個，Shift+Tab 在第一個時跳到最後一個', async () => {
        const user = userEvent.setup();
        render(<Page open />);
        screen.getByText('最後一個').focus();
        await user.tab();
        expect(screen.getByText('第一個')).toHaveFocus();
        await user.tab({ shift: true });
        expect(screen.getByText('最後一個')).toHaveFocus();
    });

    test('焦點在彈窗外時按 Tab 會被拉回彈窗內', () => {
        render(<Page open />);
        screen.getByText('背景按鈕').focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(screen.getByText('第一個')).toHaveFocus();
    });

    test('彈窗關閉後焦點還給開啟前的元素', () => {
        const { rerender } = render(<Page open={false} />);
        screen.getByText('背景按鈕').focus();
        rerender(<Page open />);
        screen.getByText('第一個').focus();
        rerender(<Page open={false} />);
        expect(screen.getByText('背景按鈕')).toHaveFocus();
    });
});
