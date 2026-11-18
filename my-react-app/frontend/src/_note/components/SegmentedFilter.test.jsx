import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SegmentedFilter from './SegmentedFilter';

const OPTIONS = [{ key: 'my', label: '我的' }, { key: 'latest', label: '最新' }, { key: 'hot', label: '熱門' }];

describe('SegmentedFilter（P5-6）', () => {
    test('是 radiogroup，目前項目被選取；指示器位置用 --i 表示目前第幾項', () => {
        const { container } = render(<SegmentedFilter options={OPTIONS} value="hot" onChange={() => {}} ariaLabel="排序" />);
        expect(screen.getByRole('radiogroup', { name: '排序' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: '熱門' })).toBeChecked();
        expect(container.querySelector('.ns-seg').style.getPropertyValue('--i')).toBe('2');
        expect(container.querySelector('.ns-seg').style.getPropertyValue('--count')).toBe('3');
    });

    test('點選項目會回報 key', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<SegmentedFilter options={OPTIONS} value="latest" onChange={onChange} ariaLabel="排序" />);
        await user.click(screen.getByRole('radio', { name: '我的' }));
        expect(onChange).toHaveBeenCalledWith('my');
    });

    test('鍵盤：Tab 只停在目前這一項，方向鍵移到下一項並選取', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<SegmentedFilter options={OPTIONS} value="latest" onChange={onChange} ariaLabel="排序" />);
        await user.tab();
        expect(screen.getByRole('radio', { name: '最新' })).toHaveFocus();
        await user.keyboard('{ArrowRight}');
        expect(onChange).toHaveBeenCalledWith('hot');
    });
});
