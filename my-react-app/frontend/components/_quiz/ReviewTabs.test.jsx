import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewTabs from './ReviewTabs';

describe('ReviewTabs（回歸測試：討論還沒真正可用；AI助手由功能旗標決定）', () => {
  test('旗標關閉（預設）時，討論／AI助手分頁一律 disabled 並標示「即將推出」，即使已經選了題目', async () => {
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

  test('旗標開啟後，AI助手分頁在選了題目時可以切換，討論仍然是即將推出', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ReviewTabs activeIndex={0} onChange={onChange} hasSelectedQuestion={true} aiEnabled={true} />);

    const aiTab = screen.getByRole('button', { name: /AI助手/ });
    expect(aiTab).toBeEnabled();
    expect(aiTab).not.toHaveTextContent('即將推出');
    expect(screen.getByRole('button', { name: /討論/ })).toBeDisabled();

    await user.click(aiTab);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  test('旗標開啟但沒有選題目時，AI助手分頁仍然被擋（沒有題目可以講解）', () => {
    render(<ReviewTabs activeIndex={0} onChange={vi.fn()} hasSelectedQuestion={false} aiEnabled={true} />);
    expect(screen.getByRole('button', { name: /AI助手/ })).toBeDisabled();
  });
});
