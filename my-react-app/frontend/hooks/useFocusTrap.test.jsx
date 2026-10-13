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

    test('開啟時由 hook 把焦點移進彈窗，關閉後還給「開啟前」的元素（不是彈窗本身）', () => {
        const { rerender } = render(<Page open={false} />);
        screen.getByText('背景按鈕').focus();
        rerender(<Page open />);
        expect(screen.getByRole('dialog')).toHaveFocus();
        rerender(<Page open={false} />);
        expect(screen.getByText('背景按鈕')).toHaveFocus();
    });

    test('autoFocus: false 時不搶焦點', () => {
        const NoAuto = ({ open }) => {
            const ref = useRef(null);
            useFocusTrap(ref, open, { autoFocus: false });
            return open ? <div ref={ref} tabIndex={-1}><button>內部</button></div> : null;
        };
        const { rerender } = render(<><button>背景按鈕</button><NoAuto open={false} /></>);
        screen.getByText('背景按鈕').focus();
        rerender(<><button>背景按鈕</button><NoAuto open /></>);
        expect(screen.getByText('背景按鈕')).toHaveFocus();
    });

    describe('Tab 不會落在看不見的元素上', () => {
        const Mixed = () => {
            const ref = useRef(null);
            useFocusTrap(ref, true);
            return (
                <div ref={ref} tabIndex={-1} role="dialog">
                    <div aria-hidden="true"><button>被 aria-hidden 包住</button></div>
                    <div inert><button>被 inert 包住</button></div>
                    <button>第一個</button>
                    <button>最後一個</button>
                    <div hidden><button>被 hidden 包住</button></div>
                    <div style={{ display: 'none' }}><button>祖先 display none</button></div>
                    <button style={{ visibility: 'hidden' }}>visibility hidden</button>
                    <input type="hidden" />
                </div>
            );
        };

        test('從最後一個按 Tab 回到第一個、第一個按 Shift+Tab 到最後一個，頭尾的看不見元素都被跳過（它們若被算進去，焦點會落在看不見的地方）', async () => {
            const user = userEvent.setup();
            render(<Mixed />);
            screen.getByText('最後一個').focus();
            await user.tab();
            expect(screen.getByText('第一個')).toHaveFocus();
            await user.tab({ shift: true });
            expect(screen.getByText('最後一個')).toHaveFocus();
        });
    });
});
