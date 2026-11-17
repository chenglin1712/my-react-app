import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';
import CameraLabelStep from './label';

vi.mock('axios');
vi.mock('../../../firebase', () => ({ auth: { currentUser: null } }));

const file = new File(['x'], 'test.png', { type: 'image/png' });
const renderStep = (props = {}) => render(
  <MemoryRouter>
    <CameraLabelStep image="data:image/png;base64,x" file={file} onConfirm={vi.fn()} onBack={vi.fn()} {...props} />
  </MemoryRouter>,
);

describe('影像辨識舞台（P3-5、P3-7、P3-8）', () => {
  beforeEach(() => axios.post.mockReset());
  afterEach(() => vi.useRealTimers());

  test('辨識中：圖片在舞台上、光帶出現（只用來輔助，aria-hidden），提示是文字', async () => {
    axios.post.mockReturnValueOnce(new Promise(() => {}));
    const { container } = renderStep();
    expect(container.querySelector('.camera-stage')).toHaveClass('is-scanning');
    expect(container.querySelector('.camera-scan')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.camera-stage-img')).toHaveAttribute('src', 'data:image/png;base64,x');
    expect(container.querySelector('.camera-stage-hint')).toHaveTextContent('辨識中，請稍候');
  });

  test('辨識超過 6 秒：提示改成「還在辨識中」的文字說明（光帶只掃一次，不無限循環）', async () => {
    vi.useFakeTimers();
    axios.post.mockReturnValueOnce(new Promise(() => {}));
    const { container } = renderStep();
    act(() => { vi.advanceTimersByTime(6100); });
    expect(container.querySelector('.camera-stage-hint')).toHaveTextContent('還在辨識中');
  });

  test('辨識完成：光帶消失，詞標籤浮在舞台上（是 ul／li／button，有依序浮現的 --i），可複選', async () => {
    axios.post.mockResolvedValueOnce({ data: { labels: [{ description: 'balay', score: 0.9 }, { description: 'cyux', score: 0.7 }] } });
    const onConfirm = vi.fn();
    const { container } = renderStep({ onConfirm });
    const list = await screen.findByRole('list', { name: '辨識出的候選單詞' });
    expect(container.querySelector('.camera-stage')).not.toHaveClass('is-scanning');
    expect(container.querySelector('.camera-stage .camera-stage-layer')).toContainElement(list);
    const items = list.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[1].style.getPropertyValue('--i')).toBe('1');
    const chip = screen.getByRole('button', { name: /balay/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip.querySelector('svg')).not.toBeNull(); // 選取有勾，不只靠顏色
    expect(container.querySelector('.camera-stage-hint')).toHaveTextContent('點選想查的詞');
    fireEvent.click(screen.getByText('確認 ✓'));
    expect(onConfirm).toHaveBeenCalledWith(['balay']);
  });

  test('失敗時舞台提示與下方說明都有文字，沒有詞標籤', async () => {
    axios.post.mockImplementationOnce(async () => { throw Object.assign(new Error('x'), { response: { status: 503 }, status: 503 }); });
    const { container } = renderStep();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(container.querySelector('.camera-stage-hint')).toHaveTextContent('辨識沒有成功');
    expect(screen.queryByRole('list', { name: '辨識出的候選單詞' })).not.toBeInTheDocument();
  });
});
