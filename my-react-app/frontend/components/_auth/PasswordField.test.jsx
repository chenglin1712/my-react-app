import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import PasswordField from './PasswordField';

const setup = () => render(<PasswordField value="secret" onChange={() => {}} />);

describe('密碼欄位', () => {
    test('預設隱藏密碼，按鈕可切換顯示與隱藏，並同步 aria 狀態', () => {
        setup();
        const input = screen.getByLabelText('密碼');
        expect(input).toHaveAttribute('type', 'password');
        const toggle = screen.getByRole('button', { name: '顯示密碼' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(toggle);
        expect(input).toHaveAttribute('type', 'text');
        expect(screen.getByRole('button', { name: '隱藏密碼' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('大寫鎖定開啟時顯示提示，關閉或離開欄位後消失', () => {
        setup();
        const input = screen.getByLabelText('密碼');
        fireEvent.keyUp(input, { key: 'A', modifierCapsLock: true });
        expect(screen.getByRole('status')).toHaveTextContent('大寫鎖定已開啟');
        fireEvent.keyUp(input, { key: 'a', modifierCapsLock: false });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        fireEvent.keyUp(input, { key: 'A', modifierCapsLock: true });
        fireEvent.blur(input);
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
});
