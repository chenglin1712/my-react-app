import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewTabs from './ReviewTabs';

describe('ReviewTabs（回歸測試：討論/AI助手目前都還沒真正可用）', () => {
  test('討論／AI助手分頁一律 disabled 並標示「即將推出」，即使已經選了題目', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReviewTabs activeIndex={0} onChange={onChange} hasSelectedQuestion={true} />);

    const discussionTab = screen.getByRole('button', { name: /討論/ });
    const aiTab = screen.getByRole('button', { name: /AI助手/ });
    expect(discussionTab).toBeDisabled();
    expect(aiTab).toBeDisabled();

    await user.click(discussionTab);
    await user.click(aiTab);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('沒有選擇題目時，測驗紀錄以外的分頁也會被擋（不只是因為 comingSoon）', () => {
    render(<ReviewTabs activeIndex={0} onChange={vi.fn()} hasSelectedQuestion={false} />);
    expect(screen.getByRole('button', { name: /討論/ })).toBeDisabled();
  });

  test('測驗紀錄分頁可以正常切換', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReviewTabs activeIndex={1} onChange={onChange} hasSelectedQuestion={true} />);

    await user.click(screen.getByRole('button', { name: '測驗紀錄' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });
});
