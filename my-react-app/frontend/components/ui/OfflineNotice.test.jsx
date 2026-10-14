import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import OfflineNotice from './OfflineNotice';

describe('OfflineNotice', () => {
  test('在線上時不顯示', () => {
    const { container } = render(<OfflineNotice online id="x" action="送出檢舉" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('離線時說明原因與要恢復連線才能做什麼，並帶 id 給按鈕的 aria-describedby', () => {
    render(<OfflineNotice online={false} id="report-offline" action="送出檢舉" />);
    const note = screen.getByRole('status');
    expect(note).toHaveAttribute('id', 'report-offline');
    expect(note).toHaveTextContent('目前沒有網路連線，恢復連線後才能送出檢舉。');
  });
});
