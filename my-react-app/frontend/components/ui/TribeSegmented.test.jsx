import { describe, test, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import TribeSegmented from './TribeSegmented';

const items = [
  { value: 'tayal', label: '泰雅族語', color: '#b66' },
  { value: 'amis', label: '阿美族語', color: '#6b6' },
  { value: 'bunun', label: '布農族語' },
];

const Controlled = ({ initial = 'tayal', onChange = () => {} }) => {
  const [v, setV] = useState(initial);
  return <TribeSegmented items={items} value={v} onChange={(x) => { setV(x); onChange(x); }} />;
};

describe('TribeSegmented（P3-2）', () => {
  test('radiogroup：選取那格 aria-checked，只有它在 Tab 順序裡；選取有勾，不只靠顏色', () => {
    const { container } = render(<Controlled initial="amis" />);
    const group = screen.getByRole('radiogroup', { name: '選擇族語' });
    const radios = screen.getAllByRole('radio');
    expect(group).toBeInTheDocument();
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(radios[1].querySelector('svg')).not.toBeNull(); // 勾
    expect(radios[0].querySelector('svg')).toBeNull();
    expect(container.querySelector('.yy-seg__track').style.getPropertyValue('--seg-i')).toBe('1');
    expect(container.querySelector('.yy-seg__track').style.getPropertyValue('--seg-n')).toBe('3');
  });

  test('點選換族語；文字只出現一次（getByText 可直接點）', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.click(screen.getByText('布農族語'));
    expect(onChange).toHaveBeenCalledWith('bunun');
    expect(screen.getByRole('radio', { name: '布農族語' })).toHaveAttribute('aria-checked', 'true');
  });

  test('← → 換族語並把焦點跟過去；到頭尾會繞回；Home／End 跳頭尾', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const first = screen.getByRole('radio', { name: '泰雅族語' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('amis');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '阿美族語' }));
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('bunun'); // 從第一個往左繞到最後一個
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('tayal');
    fireEvent.keyDown(document.activeElement, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('bunun');
  });

  test('按了修飾鍵或輸入法組字中不攔截', () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const el = screen.getByRole('radio', { name: '泰雅族語' });
    fireEvent.keyDown(el, { key: 'ArrowRight', ctrlKey: true });
    fireEvent.keyDown(el, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(el, { key: 'ArrowRight', shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  test('目前值不在清單裡：沒有任何一格被選取，指示塊隱藏，第一格仍可用 Tab 進入', () => {
    const { container } = render(<TribeSegmented items={items} value="zzz" onChange={() => {}} />);
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(screen.getAllByRole('radio')[0].tabIndex).toBe(0);
    expect(container.querySelector('.yy-seg__track')).toHaveAttribute('data-empty');
  });

  test('選到的那格在可見範圍外時，只捲這個容器（scrollBy），不捲整頁；在範圍內不動', () => {
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.classList.contains('yy-seg')) return { left: 0, right: 200, top: 0, bottom: 44, width: 200, height: 44 };
      if (this.dataset?.value === 'bunun') return { left: 260, right: 360, top: 0, bottom: 44, width: 100, height: 44 };
      return { left: 10, right: 110, top: 0, bottom: 44, width: 100, height: 44 };
    });
    const scrollBy = vi.fn();
    const original = Element.prototype.scrollBy;
    Element.prototype.scrollBy = scrollBy;
    try {
      render(<Controlled />);
      expect(scrollBy).not.toHaveBeenCalled(); // 第一格在範圍內
      fireEvent.click(screen.getByText('布農族語'));
      expect(scrollBy).toHaveBeenCalledWith({ left: 160, behavior: 'auto' });
    } finally {
      Element.prototype.scrollBy = original;
      spy.mockRestore();
    }
  });

  test('連按方向鍵從「目前聚焦的那格」算，父層還沒更新也不會漏格；空清單不出任何東西', () => {
    const onChange = vi.fn();
    render(<TribeSegmented items={items} value="tayal" onChange={onChange} />); // value 不會變（模擬父層還沒更新）
    const first = screen.getByRole('radio', { name: '泰雅族語' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement, { key: 'ArrowRight' });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['amis', 'bunun']);
    const { container } = render(<TribeSegmented items={[]} value="" onChange={() => {}} />);
    expect(container.querySelector('.yy-seg')).toBeNull();
  });
});
