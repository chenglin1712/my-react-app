import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SuccessModal from './SuccessModal';

describe('SuccessModal', () => {
  test('show 為 false 時不渲染任何內容', () => {
    const { container } = render(<SuccessModal show={false} text="成功了" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('show 為 true 時顯示傳入的文字與打勾圖示', () => {
    render(<SuccessModal show text="操作成功！" />);
    expect(screen.getByText('操作成功！')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
  });
});
